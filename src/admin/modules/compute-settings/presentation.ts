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
const backendLabels: Record<string, string> = { AVAILABLE: '已验证', UNVERIFIED: '待验证', FAILED: '验证失败', TESTING: '验证中', IMAGE_MISSING: '环境未包含', MODEL_MISSING: '缺少模型或依赖', MODEL_UNSUPPORTED: '模型未适配' }
export const backendStatus = (backend?: Backend) => backend ? backendLabels[backend.state] || backendStates[backend.state] || backend.state : '尚未确认'
export const backendTone = (backend?: Backend) => backend?.state === 'AVAILABLE' ? 'success' : backend?.state === 'FAILED' ? 'danger' : backend?.state === 'UNVERIFIED' ? 'warning' : 'info'

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
  let tag = '待验证', title = '先验证，再开始生成', hint = '模型文件已安装，还需确认运行情况。', action = 'devices'
  if (!supported) {
    tag = '此节点未提供'; title = '当前节点尚未提供此方案'; hint = '请使用节点已经提供的伴奏方案，或更新节点后重新读取运行环境。'; action = 'environment'
  } else if (profile === 'DSP_FAST') {
    tag = ready ? '可使用' : '条件未就绪'
    title = ready ? '无需 AI 模型，可尝试极速消音' : '先准备音频处理工具'
    hint = '通过声道处理削弱人声，效果因歌曲而异；依赖节点的 FFmpeg 和工作目录。'
    action = ready ? 'devices' : 'environment'
  } else if (running) {
    tag = '验证中'; title = '正在验证运行能力'; hint = '节点正在试跑，请稍候。播放任务会优先处理。'
  } else if (ready) {
    tag = '可生成'; title = '已经可以生成伴奏'; hint = `当前使用 ${backendName(selected)}。可在曲库中为单音轨歌曲生成伴奏。`
  } else if (modelBusy) {
    tag = '准备模型中'; title = '正在准备模型文件'; hint = '文件准备完成后，再验证运行环境。'; action = 'models'
  } else if (missingRuntime || !candidate) {
    tag = '缺少运行环境'; title = installed ? '模型已安装，还需准备运行环境' : '先准备运行环境，再安装模型'; hint = `${(candidate?.reason || '节点尚未提供此方案可用的推理后端').replace(/[。；]+$/, '')}${installed ? '。' : '；模型文件也尚未安装。'}`; action = 'environment'
  } else if (!installed) {
    tag = '缺少模型'; title = '先安装适合此方案的模型'; hint = '下载或导入模型文件后，再验证对应设备。'; action = 'models'
  } else if (profile === 'LEGACY_DEMUCS' && node.resourceReady === false) {
    tag = '资源不足'; title = '先释放内存或存储空间'; hint = '当前资源低于节点预算，释放后重新读取准备情况。'; action = 'environment'
  } else if (candidate.state === 'MODEL_MISSING') {
    tag = '缺少模型或依赖'; title = '还需准备设备对应的模型与依赖'; hint = candidate.reason; action = 'models'
  } else if (candidate.state === 'FAILED') {
    tag = '验证未通过'; title = '上次验证未通过'; hint = candidate.reason || '请查看设备详情，处理原因后重新验证。'
  }
  return { tag, title, hint, action, ready, installed, model, candidate, entries, selected, running, missingRuntime, operation, supported, hardwareHint }
}
