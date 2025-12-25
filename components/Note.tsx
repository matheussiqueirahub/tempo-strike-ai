/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useMemo, useRef } from 'react';
import { Extrude, Octahedron, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NoteData, COLORS, HitAccuracy } from '../types';
import { LANE_X_POSITIONS, LAYER_Y_POSITIONS, NOTE_SIZE } from '../constants';

interface NoteProps {
  data: NoteData;
  zPos: number;
  currentTime: number;
}

// --- SPARK SHAPE GENERATOR ---
const createSparkShape = (size: number) => {
  const shape = new THREE.Shape();
  const s = size / 1.8; // Scale helper

  // Start Top
  shape.moveTo(0, s);
  // Curve to Right
  shape.quadraticCurveTo(0, 0, s, 0);
  // Curve to Bottom
  shape.quadraticCurveTo(0, 0, 0, -s);
  // Curve to Left
  shape.quadraticCurveTo(0, 0, -s, 0);
  // Curve to Top
  shape.quadraticCurveTo(0, 0, 0, s);
  
  return shape;
};

const SPARK_SHAPE = createSparkShape(NOTE_SIZE);
const EXTRUDE_SETTINGS = { depth: NOTE_SIZE * 0.4, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 };

const FloatingScore: React.FC<{ accuracy?: HitAccuracy, timeSinceHit: number }> = ({ accuracy, timeSinceHit }) => {
    const textRef = useRef<THREE.Group>(null);

    useFrame(() => {
        if (textRef.current) {
            // Float up
            textRef.current.position.y += 0.02;
            // Fade out opacity logic is handled by material prop if passing refs, but simple keying works here
            const opacity = Math.max(0, 1 - (timeSinceHit * 1.5));
            textRef.current.scale.setScalar(1 + timeSinceHit * 0.2); 
            // We can't easily animate opacity on Text component without a ref to material, 
            // so we scale out or just let it disappear by the parent unmounting.
        }
    });

    if (!accuracy) return null;

    let color = 'white';
    let text = '';
    let scale = 1;

    switch (accuracy) {
        case HitAccuracy.PERFECT:
            color = '#fbbf24'; // Amber/Gold
            text = 'PERFECT';
            scale = 1.2;
            break;
        case HitAccuracy.GOOD:
            color = '#3b82f6'; // Blue
            text = 'GOOD';
            scale = 1.0;
            break;
        case HitAccuracy.BAD:
            color = '#ef4444'; // Red
            text = 'BAD';
            scale = 0.8;
            break;
    }

    return (
        <group ref={textRef} position={[0, 0.5, 0]}>
             <Text
                color={color}
                fontSize={0.4 * scale}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.02}
                outlineColor="black"
             >
                {text}
             </Text>
        </group>
    );
};

const Debris: React.FC<{ data: NoteData, timeSinceHit: number, color: string }> = ({ data, timeSinceHit, color }) => {
    const groupRef = useRef<THREE.Group>(null);
    const flashRef = useRef<THREE.Mesh>(null);

    // Animation parameters
    const flySpeed = 6.0;
    const rotationSpeed = 10.0;
    const distance = flySpeed * timeSinceHit;
    
    // Scale particles based on accuracy
    const particleScale = data.accuracy === HitAccuracy.PERFECT ? 1.5 : data.accuracy === HitAccuracy.GOOD ? 1.0 : 0.6;

    useFrame(() => {
        if (groupRef.current) {
             groupRef.current.scale.setScalar(Math.max(0.01, 1 - timeSinceHit * 1.5));
        }
        if (flashRef.current) {
            const flashDuration = 0.15;
            if (timeSinceHit < flashDuration) {
                const t = timeSinceHit / flashDuration;
                flashRef.current.visible = true;
                flashRef.current.scale.setScalar((1 + t * 4) * particleScale);
                (flashRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t;
            } else {
                flashRef.current.visible = false;
            }
        }
    });
    
    // Shards simulate the spark shattering into crystals
    const Shard = ({ offsetDir, moveDir, scale = 1 }: { offsetDir: number[], moveDir: number[], scale?: number }) => {
        const meshRef = useRef<THREE.Mesh>(null);

        useFrame(() => {
             if (meshRef.current) {
                 meshRef.current.position.x = offsetDir[0] + moveDir[0] * distance;
                 meshRef.current.position.y = offsetDir[1] + moveDir[1] * distance;
                 meshRef.current.position.z = offsetDir[2] + moveDir[2] * distance;

                 meshRef.current.rotation.x += moveDir[1] * 0.1 * rotationSpeed;
                 meshRef.current.rotation.y += moveDir[0] * 0.1 * rotationSpeed;
             }
        });

        return (
            <Octahedron ref={meshRef} args={[NOTE_SIZE * 0.3 * scale * particleScale]} position={[offsetDir[0], offsetDir[1], offsetDir[2]]}>
                 <meshStandardMaterial color={color} roughness={0.1} metalness={0.9} emissive={color} emissiveIntensity={0.5} />
            </Octahedron>
        )
    }

    return (
        <group ref={groupRef}>
            {/* Hit Flash */}
            <mesh ref={flashRef}>
                <sphereGeometry args={[NOTE_SIZE * 1.2, 16, 16]} />
                <meshBasicMaterial color="white" transparent toneMapped={false} />
            </mesh>

            {/* Shattered Pieces - 4-way burst for the 4 star points */}
            <Shard offsetDir={[0, 0.2, 0]} moveDir={[0, 1.5, -0.5]} scale={0.8} />
            <Shard offsetDir={[0.2, 0, 0]} moveDir={[1.5, 0, -0.5]} scale={0.8} />
            <Shard offsetDir={[0, -0.2, 0]} moveDir={[0, -1.5, -0.5]} scale={0.8} />
            <Shard offsetDir={[-0.2, 0, 0]} moveDir={[-1.5, 0, -0.5]} scale={0.8} />
            
            {/* Center core shards */}
            <Shard offsetDir={[0.1, 0.1, 0.1]} moveDir={[1, 1, 1]} scale={0.5} />
            <Shard offsetDir={[-0.1, -0.1, -0.1]} moveDir={[-1, -1, 1]} scale={0.5} />
            
            {/* Extra shards for perfect hits */}
            {data.accuracy === HitAccuracy.PERFECT && (
                <>
                  <Shard offsetDir={[0, 0, 0]} moveDir={[0.5, 0.5, 0]} scale={0.4} />
                  <Shard offsetDir={[0, 0, 0]} moveDir={[-0.5, 0.5, 0]} scale={0.4} />
                  <Shard offsetDir={[0, 0, 0]} moveDir={[0.5, -0.5, 0]} scale={0.4} />
                  <Shard offsetDir={[0, 0, 0]} moveDir={[-0.5, -0.5, 0]} scale={0.4} />
                </>
            )}
        </group>
    );
};

const Note: React.FC<NoteProps> = ({ data, zPos, currentTime }) => {
  const color = data.type === 'left' ? COLORS.left : COLORS.right;
  
  const position: [number, number, number] = useMemo(() => {
     return [
         LANE_X_POSITIONS[data.lineIndex],
         LAYER_Y_POSITIONS[data.lineLayer],
         zPos
     ];
  }, [data.lineIndex, data.lineLayer, zPos]);

  if (data.missed) return null;

  if (data.hit && data.hitTime) {
      return (
          <group position={position}>
              <Debris data={data} timeSinceHit={currentTime - data.hitTime} color={color} />
              <FloatingScore accuracy={data.accuracy} timeSinceHit={currentTime - data.hitTime} />
          </group>
      );
  }

  return (
    <group position={position}>
      {/* Main Spark Shape */}
      <group rotation={[0, 0, 0]}> 
        {/* We center the extrusion by offsetting z */}
        <group position={[0, 0, -NOTE_SIZE * 0.2]}>
            <Extrude args={[SPARK_SHAPE, EXTRUDE_SETTINGS]} castShadow receiveShadow>
                <meshPhysicalMaterial 
                    color={color} 
                    roughness={0.2} 
                    metalness={0.1}
                    transmission={0.1} // Slight glass effect
                    thickness={0.5}
                    emissive={color}
                    emissiveIntensity={0.8} // Glowing inner light
                />
            </Extrude>
        </group>
      </group>
      
      {/* Inner Core Glow (Replaces Arrow) */}
      <mesh position={[0, 0, NOTE_SIZE * 0.1]}>
         <octahedronGeometry args={[NOTE_SIZE * 0.2, 0]} />
         <meshBasicMaterial color="white" toneMapped={false} transparent opacity={0.8} />
      </mesh>

      {/* Outer Wireframe Glow for emphasis */}
      <group position={[0, 0, -NOTE_SIZE * 0.2]}>
          <mesh>
             <extrudeGeometry args={[SPARK_SHAPE, { ...EXTRUDE_SETTINGS, depth: EXTRUDE_SETTINGS.depth * 1.1 }]} />
             <meshBasicMaterial color={color} wireframe transparent opacity={0.3} />
          </mesh>
      </group>
    </group>
  );
};

export default React.memo(Note, (prev, next) => {
    // Re-render if hit status changes to show explosion
    if (prev.data.hit !== next.data.hit) return false;
    // Otherwise only re-render if position changed significantly (though in this loop we usually render every frame via parent mapping, optimization depends on implementation)
    // Actually, in the parent loop we create new components every frame effectively if mapping directly, 
    // but React reconciles. We need to be careful not to block updates.
    return prev.zPos === next.zPos && prev.data.missed === next.data.missed;
});