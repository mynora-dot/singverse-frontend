import type { Backend, Model, Node, SeparationProfile } from '../audio-processing/api'
import { backendName, backendStates, generationProfiles, generationProfileNames } from '../audio-processing/presentation'
import { isRelevantBackend } from '../audio-processing/node-hardware'

export const audioPlans = generationProfiles.map(id => ({ id, label: generationProfileNames[id] }))
export const modelCatalog = (node: Node): Model[] => node.models || [node.model]
export const modelForBackend = (node: Node, id?: string | null) => modelCatalog(node).find(model => model.id === (id === 'openvino' ? 'htdemucs-openvino' : id === 'rknn' ? 'uvr-mdxnet-9482-rknn' : 'htdemucs'))
export function planBackends(node: Node, profile: SeparationProfile): Backend[] {
  const entries = profile === 'AI_CLEAN' ? node.separation?.backends || [] : node.backends
  return entries.filter(isRelevantBackend)
}
export const canVerify = (backend: Backend) => ['AVAILABLE', 'UNVERIFIED', 'FAILED'].includes(backend.state)
const backendLabels: Record<string, string> = { AVAILABLE: '已验证', UNVERIFIED: '待验证', FAILED: '验证失败', TESTING: '验证中', IMAGE_MISSING: '环境未包含', MODEL_MISSING: '待准备', MODEL_UNSUPPORTED: '设备暂不支持' }
export const backendStatus = (backend?: Backend) => backend ? backendLabels[backend.state] || backendStates[backend.state] || backend.state : '尚未确认'
export const backendTone = (backend?: Backend) => backend?.state === 'AVAILABLE' ? 'success' : backend?.state === 'FAILED' ? 'danger' : backend?.state === 'UNVERIFIED' ? 'warning' : 'info'

const backendHelp: Record<string, string> = {
  IMAGE_MISSING: '请部署支持此设备的计算服务版本。',
  RUNTIME_MISSING: '请检查设备驱动和计算服务的运行环境。',
  MODEL_UNSUPPORTED: '可以尝试其他设备或切换到快速档。',
  FAILED: '请检查设备运行环境后重试。',
}
export const backendReason = (backend: Backend) => backendHelp[backend.state] || ''

export function audioPlanStatus(node: Node, profile: SeparationProfile) {
  const capability = node.separation?.profiles.find(item => item.id === profile)
  const supported = profile === 'LEGACY_DEMUCS' || !!capability
  const entries = planBackends(node, profile)
  const detected = entries.filter(item => item.id !== 'cpu' && (item.detected || item.device))
  const macGpu = node.environment.system === 'Darwin' && detected.some(item => ['mps', 'coreml', 'mlx'].includes(item.id))
  const hardwareHint = detected.length ? macGpu ? `已检测到 Mac GPU${node.environment.processor ? `（${node.environment.processor}）` : ''}。` : `已检测到 ${detected.map(item => backendName(item.id)).join('、')}。` : ''
  const selected = profile === 'AI_CLEAN' ? node.separation?.selected || capability?.backend : node.selected
  const selectedBackend = entries.find(item => item.id === selected)
  const cpu = entries.find(item => item.id === 'cpu')
  // 轻量模型必须先验证独立 CPU 环境，再验证加速设备。
  const candidate = profile === 'AI_CLEAN' && cpu?.state !== 'AVAILABLE' ? cpu : selectedBackend
    || entries.find(item => item.id !== 'cpu' && canVerify(item))
    || entries.find(item => item.id !== 'cpu') || cpu || entries[0]
  const model = profile === 'AI_CLEAN'
    ? modelCatalog(node).find(item => item.id === 'uvr-mdxnet-9482')
    : modelForBackend(node, selected || candidate?.id)
  const installed = !!model?.installed
  const operation = profile === 'AI_CLEAN' ? node.separation?.operation : node.operation
  const running = ['TESTING', 'WAITING'].includes(operation?.state || '') || entries.some(item => item.state === 'TESTING')
    || profile === 'LEGACY_DEMUCS' && ['CHECKING', 'WAITING', 'TESTING'].includes(node.startupCheck?.state || '')
  const ready = profile === 'DSP_FAST' ? capability?.ready === true
    : profile === 'AI_CLEAN' ? capability?.ready === true && !!selected && cpu?.state === 'AVAILABLE'
      : (capability ? capability.ready : !!selected) && !!selected && selectedBackend?.state === 'AVAILABLE' && node.resourceReady !== false
  const missingRuntime = !!candidate && ['IMAGE_MISSING', 'RUNTIME_MISSING', 'MODEL_UNSUPPORTED'].includes(candidate.state)
  const modelBusy = ['DOWNLOADING', 'IMPORTING', 'VERIFYING'].includes(node.operation.state)
  let tag = '待验证', title = '先验证，再开始生成', hint = '验证通过后可生成伴奏。', action = 'devices'
  if (!supported) {
    tag = '此节点未提供'; title = '当前节点尚未提供此方案'; hint = '请使用节点已经提供的伴奏方案，或更新节点后重新读取运行环境。'; action = 'environment'
  } else if (profile === 'DSP_FAST') {
    tag = ready ? '可使用' : '条件未就绪'
    title = ready ? '可以使用快速档' : '先准备音频处理工具'
    hint = '通过声道处理削弱人声，效果因歌曲而异；依赖节点的 FFmpeg 和工作目录。'
    action = ready ? 'devices' : 'environment'
  } else if (running) {
    tag = '验证中'; title = '正在验证运行能力'; hint = '节点正在试跑，请稍候。播放任务会优先处理。'
  } else if (ready) {
    tag = '可生成'; title = '已经可以生成伴奏'; hint = `当前使用 ${backendName(selected)}。可在曲库中为单音轨歌曲生成伴奏。`
  } else if (modelBusy) {
    tag = '正在准备'; title = '正在准备伴奏'; hint = '准备完成后可验证设备。'; action = 'models'
  } else if (missingRuntime || !candidate) {
    tag = candidate?.state === 'MODEL_UNSUPPORTED' ? '设备暂不支持' : '缺少运行环境'
    title = tag; hint = candidate ? backendReason(candidate) : '尚未检测到可用于此方案的处理设备。'; action = 'environment'
  } else if (!installed) {
    tag = '待准备'; title = '先准备伴奏功能'; hint = '安装完成后可验证设备。'; action = 'models'
  } else if (profile === 'LEGACY_DEMUCS' && node.resourceReady === false) {
    tag = '资源不足'; title = '先释放内存或存储空间'; hint = '当前资源低于节点预算，释放后重新读取准备情况。'; action = 'environment'
  } else if (candidate.state === 'MODEL_MISSING') {
    tag = '待准备'; title = '还需完成设备准备'; hint = '请完成安装或检查运行环境。'; action = 'models'
  } else if (candidate.state === 'FAILED') {
    tag = '验证未通过'; title = '上次验证未通过'; hint = backendReason(candidate)
  }
  return { tag, title, hint, action, ready, installed, model, candidate, entries, selected, running, missingRuntime, operation, supported, hardwareHint }
}
