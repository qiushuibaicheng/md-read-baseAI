import { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface Props {
  theme: 'light' | 'dark'
  enabled: boolean
}

/**
 * 背景：低多边形点阵波场。用 ShaderMaterial 在 GPU 上做波动，
 * CPU 每帧只更新一个 uniform，保证长时间运行也不掉帧。
 */
export default function ThreeBackground({ theme, enabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100)
    camera.position.set(0, 3.4, 7.6)

    const COLS = 64
    const ROWS = 40
    const GAP = 0.56
    const count = COLS * ROWS
    const positions = new Float32Array(count * 3)
    const phases = new Float32Array(count)
    let i = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        positions[i * 3] = (c - (COLS - 1) / 2) * GAP
        positions[i * 3 + 1] = 0
        positions[i * 3 + 2] = (r - (ROWS - 1) / 2) * GAP
        phases[i] = Math.random() * Math.PI * 2
        i++
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

    const dark = theme === 'dark'
    const uniforms = {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(dark ? '#6d92ff' : '#4f7bff') },
      uColorB: { value: new THREE.Color(dark ? '#c084fc' : '#a855f7') },
      uOpacity: { value: dark ? 0.55 : 0.42 },
      uSize: { value: dark ? 4.2 : 3.6 }
    }

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        uniform float uTime;
        uniform float uSize;
        attribute float aPhase;
        varying float vH;
        void main() {
          vec3 p = position;
          float h = sin(p.x * 0.52 + uTime * 0.55 + aPhase) * 0.42
                  + cos(p.z * 0.46 + uTime * 0.42) * 0.36
                  + sin((p.x + p.z) * 0.28 + uTime * 0.3) * 0.22;
          p.y += h;
          vH = h;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (10.0 / -mv.z) * (1.0 + h * 0.25);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uOpacity;
        varying float vH;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.06, d) * uOpacity * 0.9;
          vec3 col = mix(uColorA, uColorB, clamp(vH * 0.55 + 0.5, 0.0, 1.0));
          gl_FragColor = vec4(col, a);
        }
      `
    })

    const points = new THREE.Points(geometry, material)
    points.rotation.x = 0.06
    scene.add(points)

    const resize = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let mx = 0
    let my = 0
    let tx = 0
    let ty = 0
    const onMove = (e: MouseEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2
      ty = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', onMove)

    const clock = new THREE.Clock()
    let raf = 0
    let visible = true
    const onVis = () => {
      visible = !document.hidden
    }
    document.addEventListener('visibilitychange', onVis)

    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!visible) return
      uniforms.uTime.value = clock.getElapsedTime()
      mx += (tx - mx) * 0.045
      my += (ty - my) * 0.045
      camera.position.x = mx * 0.7
      camera.position.y = 3.4 - my * 0.42
      camera.lookAt(0, 0.1, 0)
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [theme, enabled])

  if (!enabled) return null

  return (
    <div className="bg-layer" aria-hidden>
      <canvas ref={canvasRef} className="bg-canvas" />
      <div className="bg-glow bg-glow-a" />
      <div className="bg-glow bg-glow-b" />
      <div className="bg-vignette" />
    </div>
  )
}
