/** 视频编码方式和音频推理后端分别来自节点，不以浏览器所在设备推断。 */
export interface HardwareSettingsValue {
  backend: string
  effectiveBackend: string
  deploymentBackend: string
  revision: number
  writable: boolean
  cpuFallback?: boolean
  detectedBackends?: string[]
}
export interface HardwareTestResult { passed: boolean; backend: string; hardware: boolean; elapsedMs: number }
export interface EncoderCapability {
  decodeAcceleration?: boolean
  toneMappingAcceleration?: boolean
  zeroCopy?: boolean
  backend: string
  installed: boolean
  samplePassed: boolean
  codecs: Record<string, { samplePassed: boolean }>
}
export const videoChoices = [
  { value: 'deployment', label: '遵循部署配置' },
  { value: 'auto', label: '自动选择可用硬件' },
  { value: 'software', label: 'CPU 软件处理' },
  { value: 'videotoolbox', label: 'Mac（VideoToolbox）' },
  { value: 'nvenc', label: 'NVIDIA（NVENC）' },
  { value: 'qsv', label: 'Intel（Quick Sync / QSV）' },
  { value: 'vaapi', label: 'VA-API（Linux）' },
  { value: 'amf', label: 'AMD（Windows AMF）' },
  { value: 'rkmpp', label: 'Rockchip（RKMPP）' },
]
export const videoBackendName = (value: string) => videoChoices.find(choice => choice.value === value)?.label ?? value

export function currentVideoBackend(settings: HardwareSettingsValue) {
  const { effectiveBackend: backend, detectedBackends: detected } = settings
  if (backend === 'auto' && detected?.length === 0) return settings.cpuFallback !== false ? 'CPU 软件处理' : '暂无可用加速设备'
  if (!['auto', 'software'].includes(backend) && detected && !detected.includes(backend)) return '所配置的加速设备未检测到'
  return videoBackendName(backend)
}
