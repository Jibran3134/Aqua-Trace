import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { rng } from "../../lib/rng";
import net3 from "../../mock/data/net3.json";

// The intro draws the real Net3 topology: x/z from .inp coordinates, height from true elevation.
// Static data only, so it renders with no backend and never knows any scenario's truth.
const SPAN = 15;
const HEIGHT = 3.2;

interface Placed {
  id: string;
  type: string;
  p: THREE.Vector3;
}

function usePlacedNetwork() {
  return useMemo(() => {
    const xs = net3.nodes.map((n) => n.x);
    const ys = net3.nodes.map((n) => n.y);
    const elev = net3.elevation as Record<string, number>;
    const es = Object.values(elev);
    const [minX, maxX, minY, maxY, minE, maxE] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...es), Math.max(...es)];
    const scale = SPAN / Math.max(maxX - minX, maxY - minY);
    const nodes: Placed[] = net3.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      p: new THREE.Vector3((n.x - (minX + maxX) / 2) * scale, ((elev[n.id] - minE) / (maxE - minE || 1)) * HEIGHT, -(n.y - (minY + maxY) / 2) * scale),
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pipes = net3.pipes.map((l) => [byId.get(l.from)!.p, byId.get(l.to)!.p, l.kind] as const);
    return { nodes, pipes };
  }, []);
}

/** All pipes as one instanced mesh of thin cylinders oriented between their end points. */
function Pipes({ pipes }: { pipes: readonly (readonly [THREE.Vector3, THREE.Vector3, string])[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    pipes.forEach(([a, b], i) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = Math.max(dir.length(), 0.001);
      q.setFromUnitVectors(up, dir.normalize());
      m.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [pipes]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, pipes.length]}>
      <cylinderGeometry args={[0.035, 0.035, 1, 6]} />
      <meshStandardMaterial color="#3fbfa6" emissive="#2a9c86" emissiveIntensity={0.95} roughness={0.4} metalness={0.5} />
    </instancedMesh>
  );
}

function Junctions({ nodes }: { nodes: Placed[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const js = nodes.filter((n) => n.type === "junction");
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    js.forEach((n, i) => ref.current!.setMatrixAt(i, m.makeTranslation(n.p.x, n.p.y, n.p.z)));
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [js]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, js.length]}>
      <sphereGeometry args={[0.08, 12, 12]} />
      <meshStandardMaterial color="#e8e2d0" emissive="#6fe0c7" emissiveIntensity={0.25} roughness={0.3} />
    </instancedMesh>
  );
}

function Sources({ nodes }: { nodes: Placed[] }) {
  return (
    <>
      {nodes
        .filter((n) => n.type !== "junction")
        .map((n) => (
          <mesh key={n.id} position={n.p}>
            {n.type === "reservoir" ? <boxGeometry args={[0.55, 0.3, 0.55]} /> : <cylinderGeometry args={[0.22, 0.22, 0.42, 20]} />}
            <meshStandardMaterial color="#13292e" emissive="#3fbfa6" emissiveIntensity={0.35} roughness={0.4} metalness={0.5} />
          </mesh>
        ))}
    </>
  );
}

/** A pulsing vermilion source with rising droplets: the leak nobody has located yet. */
function LeakPulse({ at }: { at: THREE.Vector3 }) {
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const drops = useRef<THREE.Points>(null);
  const seeds = useMemo(() => {
    const r = rng(42); // seeded: identical droplets on every render and every machine
    return Float32Array.from({ length: 60 * 3 }, () => r());
  }, []);
  const initial = useMemo(() => new Float32Array(60 * 3), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const phase = (t % 2.2) / 2.2;
    ring.current!.scale.setScalar(0.4 + phase * 3.2);
    (ring.current!.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - phase);
    core.current!.scale.setScalar(1 + 0.18 * Math.sin(t * 4));
    // Write straight into the GPU buffer owned by the geometry.
    const attr = drops.current!.geometry.attributes.position as THREE.BufferAttribute;
    const positions = attr.array as Float32Array;
    for (let i = 0; i < 60; i++) {
      const life = (t * 0.45 + seeds[i * 3]) % 1;
      const ang = seeds[i * 3 + 1] * Math.PI * 2;
      const r = 0.05 + life * 0.45 * seeds[i * 3 + 2];
      positions[i * 3] = at.x + Math.cos(ang) * r;
      positions[i * 3 + 1] = at.y + life * 1.4;
      positions[i * 3 + 2] = at.z + Math.sin(ang) * r;
    }
    attr.needsUpdate = true;
  });
  return (
    <group>
      <mesh ref={core} position={at}>
        <sphereGeometry args={[0.16, 20, 20]} />
        <meshStandardMaterial color="#ff5a36" emissive="#ff5a36" emissiveIntensity={2.2} />
      </mesh>
      <pointLight position={at} color="#ff5a36" intensity={6} distance={4.5} />
      <mesh ref={ring} position={at} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.24, 48]} />
        <meshBasicMaterial color="#ff5a36" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <points ref={drops}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[initial.slice(), 3]} />
        </bufferGeometry>
        <pointsMaterial color="#6fe0c7" size={0.05} transparent opacity={0.8} sizeAttenuation />
      </points>
    </group>
  );
}

function Rig({ still, dive, children }: { still: boolean; dive: boolean; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ pointer, clock }, dt) => {
    const g = group.current;
    if (!g) return;
    if (dive) {
      // Unwind to the 2D map's orientation: no spin, no tilt, no bob.
      const target = Math.round(g.rotation.y / (Math.PI * 2)) * Math.PI * 2;
      g.rotation.y += (target - g.rotation.y) * Math.min(1, dt * 4);
      g.rotation.x += -g.rotation.x * Math.min(1, dt * 4);
      g.position.y += -g.position.y * Math.min(1, dt * 4);
      return;
    }
    if (!still) g.rotation.y += dt * 0.07;
    // Gentle pointer parallax: the scene leans toward the cursor.
    const tx = still ? 0 : pointer.y * 0.12;
    g.rotation.x += (tx - g.rotation.x) * 0.05;
    g.position.y = still ? 0 : Math.sin(clock.elapsedTime * 0.6) * 0.08;
  });
  return <group ref={group}>{children}</group>;
}

/** Slides the scene from its right-of-headline offset back to centre during the dive. */
function Offset({ dive, children }: { dive: boolean; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!g.current) return;
    const target = dive ? 0 : 3.4;
    g.current.position.x += (target - g.current.position.x) * Math.min(1, dt * 3.5);
  });
  return (
    <group ref={g} position={[3.4, 0, 0]}>
      {children}
    </group>
  );
}

/** Camera move from the oblique hero shot to straight top-down: the same framing as the 2D map. */
function CameraDive({ dive }: { dive: boolean }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, -1.2, 0));
  useFrame((_, dt) => {
    if (!dive) return;
    const k = Math.min(1, dt * 3.2);
    camera.position.lerp(new THREE.Vector3(0, 19, 0.01), k);
    camera.up.lerp(new THREE.Vector3(0, 0, -1), k);
    camera.lookAt(look.current);
  });
  return null;
}

/** The six default pressure sensors, lit one by one in the "approach" beat (decorative). */
const SENSOR_IDS = ["60", "15", "35", "10", "50", "219"];
function Sensors({ nodes, on }: { nodes: Placed[]; on: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const start = useRef<number | null>(null);
  const placed = useMemo(() => SENSOR_IDS.map((id) => nodes.find((n) => n.id === id)?.p).filter(Boolean) as THREE.Vector3[], [nodes]);
  useFrame(({ clock }) => {
    if (on && start.current === null) start.current = clock.elapsedTime;
    if (!on) start.current = null;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const t = start.current === null ? -1 : clock.elapsedTime - start.current - i * 0.35;
      const s = t < 0 ? 0.001 : Math.min(1, t * 3) * (1 + 0.12 * Math.sin(clock.elapsedTime * 3 + i));
      m.scale.setScalar(s);
    });
  });
  return (
    <>
      {placed.map((p, i) => (
        <mesh key={i} ref={(el) => void (refs.current[i] = el)} position={[p.x, p.y + 0.35, p.z]} scale={0.001}>
          <octahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial color="#d4f26a" emissive="#d4f26a" emissiveIntensity={1.4} />
        </mesh>
      ))}
    </>
  );
}

export default function NetworkScene({ still, beat = 2, dive = false }: { still: boolean; beat?: number; dive?: boolean }) {
  const { nodes, pipes } = usePlacedNetwork();
  // Decorative pulse at the junction nearest the network's centre: always in frame, never a scenario's truth.
  const leak = useMemo(() => {
    const js = nodes.filter((n) => n.type === "junction");
    const c = js.reduce((acc, n) => acc.add(n.p), new THREE.Vector3()).divideScalar(js.length);
    return js.reduce((best, n) => (n.p.distanceTo(c) < best.distanceTo(c) ? n.p : best), js[0].p);
  }, [nodes]);
  return (
    <Canvas camera={{ position: [0, 8.5, 12.5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <color attach="background" args={["#071316"]} />
      <fog attach="fog" args={["#071316", 14, 30]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 12, 4]} intensity={1.1} color="#e8e2d0" />
      <directionalLight position={[-8, 4, -6]} intensity={0.5} color="#b48cff" />
      <CameraDive dive={dive} />
      {/* Offset right so the headline column on the left stays clean; recentres on the dive. */}
      <Offset dive={dive}>
        <Rig still={still} dive={dive}>
          <group position={[0, -1.2, 0]}>
            <Pipes pipes={pipes} />
            <Junctions nodes={nodes} />
            <Sources nodes={nodes} />
            <Sensors nodes={nodes} on={beat >= 1} />
            {beat >= 2 && <LeakPulse at={leak} />}
            <gridHelper args={[24, 24, "#1b3639", "#10262b"]} position={[0, -0.05, 0]} />
          </group>
        </Rig>
      </Offset>
    </Canvas>
  );
}
