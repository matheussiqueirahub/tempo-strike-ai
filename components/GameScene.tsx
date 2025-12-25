/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Grid, PerspectiveCamera, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { GameStatus, NoteData, HandPositions, COLORS, CutDirection, HitAccuracy } from '../types';
import { PLAYER_Z, SPAWN_Z, MISS_Z, NOTE_SPEED, DIRECTION_VECTORS, NOTE_SIZE, LANE_X_POSITIONS, LAYER_Y_POSITIONS, SONG_BPM } from '../constants';
import Note from './Note';
import Saber from './Saber';

interface GameSceneProps {
  gameStatus: GameStatus;
  audioRef: React.RefObject<HTMLAudioElement>;
  handPositionsRef: React.MutableRefObject<any>; // Simplified type for the raw ref
  chart: NoteData[];
  onNoteHit: (note: NoteData, accuracy: HitAccuracy) => void;
  onNoteMiss: (note: NoteData) => void;
  onSongEnd: () => void;
}

const BEAT_TIME = 60 / SONG_BPM;

const GameScene: React.FC<GameSceneProps> = ({ 
    gameStatus, 
    audioRef, 
    handPositionsRef, 
    chart,
    onNoteHit,
    onNoteMiss,
    onSongEnd
}) => {
  // Local state for notes to trigger re-renders when they are hit/missed
  const [notesState, setNotesState] = useState<NoteData[]>(chart);
  const [currentTime, setCurrentTime] = useState(0);

  // Refs for things we don't want causing re-renders every frame
  const activeNotesRef = useRef<NoteData[]>([]);
  const nextNoteIndexRef = useRef(0);
  const shakeIntensity = useRef(0);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);

  // Helper Vector3s for collision to avoid GC
  const vecA = useMemo(() => new THREE.Vector3(), []);
  const vecB = useMemo(() => new THREE.Vector3(), []);

  // Wrap onNoteHit to add Scene-level effects (Camera shake)
  const handleHit = (note: NoteData, accuracy: HitAccuracy) => {
      // More shake for better hits
      if (accuracy === HitAccuracy.PERFECT) shakeIntensity.current = 0.4;
      else if (accuracy === HitAccuracy.GOOD) shakeIntensity.current = 0.2;
      else shakeIntensity.current = 0.1;
      
      onNoteHit(note, accuracy);
  }

  useFrame((state, delta) => {
    // --- Beat Pulsing ---
    // Calculate a value from 0 to 1 that peaks exactly on the beat and decays quickly
    // phase is 0.0 right ON the beat, and goes up to 1.0 just before next beat
    if (audioRef.current && gameStatus === GameStatus.PLAYING) {
        const time = audioRef.current.currentTime;
        const beatPhase = (time % BEAT_TIME) / BEAT_TIME;
        // Sharp decay curve: Math.pow(1 - beatPhase, 3)
        const pulse = Math.pow(1 - beatPhase, 4); 
        
        if (ambientLightRef.current) {
            ambientLightRef.current.intensity = 0.1 + (pulse * 0.3);
        }
        if (spotLightRef.current) {
            spotLightRef.current.intensity = 0.5 + (pulse * 1.5);
        }
    }

    // --- Camera Shake ---
    if (shakeIntensity.current > 0 && cameraRef.current) {
        const shake = shakeIntensity.current;
        cameraRef.current.position.x = (Math.random() - 0.5) * shake;
        cameraRef.current.position.y = 1.8 + (Math.random() - 0.5) * shake;
        cameraRef.current.position.z = 4 + (Math.random() - 0.5) * shake;
        
        // Decay shake
        shakeIntensity.current = THREE.MathUtils.lerp(shakeIntensity.current, 0, 10 * delta);
        if (shakeIntensity.current < 0.01) {
             shakeIntensity.current = 0;
             // Reset to exact base position when done shaking
             cameraRef.current.position.set(0, 1.8, 4);
        }
    }

    if (gameStatus !== GameStatus.PLAYING || !audioRef.current) return;

    // Sync time with audio
    const time = audioRef.current.currentTime;
    setCurrentTime(time);

    if (audioRef.current.ended) {
        onSongEnd();
        return;
    }

    // 1. Spawn Notes
    // Look ahead by the time it takes for a note to travel from spawn to player
    const spawnAheadTime = Math.abs(SPAWN_Z - PLAYER_Z) / NOTE_SPEED;
    
    while (nextNoteIndexRef.current < notesState.length) {
      const nextNote = notesState[nextNoteIndexRef.current];
      if (nextNote.time - spawnAheadTime <= time) {
        activeNotesRef.current.push(nextNote);
        nextNoteIndexRef.current++;
      } else {
        break;
      }
    }

    // 2. Update & Collide Notes
    const hands = handPositionsRef.current as HandPositions;

    for (let i = activeNotesRef.current.length - 1; i >= 0; i--) {
        const note = activeNotesRef.current[i];
        if (note.hit || note.missed) continue;

        // Calculate current Z position
        const timeDiff = note.time - time; 
        const currentZ = PLAYER_Z - (timeDiff * NOTE_SPEED);

        // Miss check (passed player)
        if (currentZ > MISS_Z) {
            note.missed = true;
            onNoteMiss(note);
            activeNotesRef.current.splice(i, 1);
            continue;
        }

        // Collision Window Check
        // Relaxed window to make hitting easier
        if (currentZ > PLAYER_Z - 2.0 && currentZ < PLAYER_Z + 1.5) {
            const handPos = note.type === 'left' ? hands.left : hands.right;
            const handVel = note.type === 'left' ? hands.leftVelocity : hands.rightVelocity;

            if (handPos) {
                 const notePos = vecA.set(
                     LANE_X_POSITIONS[note.lineIndex],
                     LAYER_Y_POSITIONS[note.lineLayer],
                     currentZ
                 );

                 // Distance Check (Saber touching Note)
                 // Radius increased to 1.2 to be more forgiving
                 if (handPos.distanceTo(notePos) < 1.2) {
                     const speed = handVel.length();
                     let angleScore = 0; // 0 to 1

                     // 1. Direction/Speed Check
                     // Lowered speed threshold to 0.5
                     if (speed < 0.5) {
                         // Too slow
                         continue; 
                     }

                     if (note.cutDirection !== CutDirection.ANY) {
                         const requiredDir = DIRECTION_VECTORS[note.cutDirection];
                         vecB.copy(handVel).normalize();
                         const dot = vecB.dot(requiredDir);
                         angleScore = dot; // 1.0 is perfect alignment, 0.0 is 90 deg off
                     } else {
                         angleScore = 1.0; // Direction doesn't matter
                     }

                     // Lowered angle threshold to 0.1
                     if (angleScore > 0.1) {
                        
                         // 2. Timing/Accuracy Calculation
                         const distanceToPerfect = Math.abs(currentZ - PLAYER_Z);
                         let accuracy = HitAccuracy.BAD;

                         // Relaxed thresholds for accuracy
                         // Perfect: < 0.5 units
                         // Good: < 1.0 units
                         
                         if (distanceToPerfect < 0.5 && angleScore > 0.5) {
                             accuracy = HitAccuracy.PERFECT;
                         } else if (distanceToPerfect < 1.0 && angleScore > 0.2) {
                             accuracy = HitAccuracy.GOOD;
                         } else {
                             accuracy = HitAccuracy.BAD;
                         }

                         note.hit = true;
                         note.hitTime = time;
                         note.accuracy = accuracy;
                         
                         handleHit(note, accuracy);
                         activeNotesRef.current.splice(i, 1);
                     }
                 }
            }
        }
    }
  });

  // Map active notes to components. 
  const visibleNotes = useMemo(() => {
     return notesState.filter(n => 
         !n.missed && 
         (!n.hit || (currentTime - (n.hitTime || 0) < 0.8)) && // Keep hit notes slightly longer for text fade
         (n.time - currentTime) < 5 && 
         (n.time - currentTime) > -2 
     );
  }, [notesState, currentTime]);

  // Refs for visual sabers
  const leftHandPosRef = useRef<THREE.Vector3 | null>(null);
  const rightHandPosRef = useRef<THREE.Vector3 | null>(null);
  const leftHandVelRef = useRef<THREE.Vector3 | null>(null);
  const rightHandVelRef = useRef<THREE.Vector3 | null>(null);

  useFrame(() => {
     leftHandPosRef.current = handPositionsRef.current.left;
     rightHandPosRef.current = handPositionsRef.current.right;
     leftHandVelRef.current = handPositionsRef.current.leftVelocity;
     rightHandVelRef.current = handPositionsRef.current.rightVelocity;
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 1.8, 4]} fov={60} />
      <color attach="background" args={['#050505']} />
      <fog attach="fog" args={['#050505', 10, 50]} />
      
      {/* Pulsing Lights */}
      <ambientLight ref={ambientLightRef} intensity={0.2} />
      <spotLight ref={spotLightRef} position={[0, 10, 5]} angle={0.5} penumbra={1} intensity={1} castShadow />
      
      <Environment preset="night" />

      {/* Floor / Track visuals */}
      <Grid position={[0, 0, 0]} args={[6, 100]} cellThickness={0.1} cellColor="#333" sectionSize={5} sectionThickness={1.5} sectionColor={COLORS.right} fadeDistance={60} infiniteGrid />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[4, 100]} />
          <meshStandardMaterial color="#111" roughness={0.8} metalness={0.5} />
      </mesh>
      
      <Stars radius={50} depth={50} count={2000} factor={4} saturation={0} fade speed={1} />

      <Saber type="left" positionRef={leftHandPosRef} velocityRef={leftHandVelRef} />
      <Saber type="right" positionRef={rightHandPosRef} velocityRef={rightHandVelRef} />

      {visibleNotes.map(note => (
          <Note 
            key={note.id} 
            data={note} 
            zPos={PLAYER_Z - ((note.time - currentTime) * NOTE_SPEED)} 
            currentTime={currentTime}
          />
      ))}
    </>
  );
};

export default GameScene;