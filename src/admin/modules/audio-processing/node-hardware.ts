import type { Backend, Model, Node } from './api'

/** 兼容旧节点的设备信息和试跑结果；明确未检测到时不以运行库状态推断硬件。 */
export const isDetectedBackend = (backend: Backend) => backend.detected
  ?? (!!backend.device || ['AVAILABLE', 'TESTING', 'FAILED'].includes(backend.state))

export const isRelevantBackend = (backend: Backend) => backend.id === 'cpu' || isDetectedBackend(backend)

export const detectedAudioBackends = (node: Node) => [...node.backends, ...(node.separation?.backends || [])].filter(isDetectedBackend)

const modelBackends: Record<string, string[]> = {
  htdemucs: ['cpu', 'cuda', 'rocm', 'mps'],
  'htdemucs-openvino': ['openvino'],
  'uvr-mdxnet-9482': ['cpu'],
  'uvr-mdxnet-9482-rknn': ['rknn'],
}

export function applicableModels(node: Node): Model[] {
  const backends = new Set(['cpu', ...detectedAudioBackends(node).map(backend => backend.id)])
  const models = node.models || [{ ...node.model, id: node.model.id || 'htdemucs' }]
  return models.filter(model => (model.backends || modelBackends[model.id] || []).some(id => backends.has(id)))
}
