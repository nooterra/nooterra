"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Points, PointMaterial } from "@react-three/drei";
import { useMemo } from "react";

function Nodes() {
  const count = 500;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.2 * Math.random();
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      arr[i * 3 + 0] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    return arr;
  }, [count]);

  return (
    <Points positions={positions} stride={3} frustumCulled>
      <PointMaterial transparent color="#7dd3fc" size={0.02} sizeAttenuation depthWrite={false} />
    </Points>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0 opacity-60">
      <Canvas camera={{ position: [0, 0, 2.5], fov: 55 }}>
        <ambientLight intensity={0.4} />
        <pointLight position={[2, 2, 2]} intensity={1.5} color="#7dd3fc" />
        <pointLight position={[-2, -1, -2]} intensity={1.2} color="#a855f7" />
        <Nodes />
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.4} />
      </Canvas>
    </div>
  );
}
