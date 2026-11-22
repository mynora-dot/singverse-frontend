// @vitest-environment jsdom
import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import FormalMetadataDifferences from '../src/admin/modules/song-management/components/FormalMetadataDifferences.vue'
import type { FormalDocument } from '../src/admin/modules/song-management/api/formal'

it('按字段对照可读的新旧值，保留来源类别及无法解析的原文', async () => {
  const document: FormalDocument = {
    schemaVersion: '1.0',
    id: 'song',
    type: 'SONG',
    revision: '1',
    fields: {
      title: '本机歌名',
      artists: ['甲', '乙'],
      referenceDurationMs: 0,
      externalIds: { source: 'track-1' },
    },
    states: {
      aliases: { decision: 'CLEAR', status: 'CLEARED', origin: { kind: 'MANUAL' }, revision: '1' },
    },
  }

  const wrapper = mount(FormalMetadataDifferences, {
    props: {
      document,
      items: [
        { field_name: 'title', source_key: 'SHARED:collection', incoming_json: '"来源歌名"' },
        { field_name: 'artists', source_key: 'FILE', incoming_json: '["丙","丁"]' },
        { field_name: 'referenceDurationMs', source_key: 'FILE', incoming_json: '205583' },
        { field_name: 'aliases', source_key: 'SHARED:collection', incoming_json: 'null' },
        { field_name: 'externalIds', source_key: 'FILE', incoming_json: '{"source":"track-2"}' },
        { field_name: 'legacy', source_key: 'FILE', incoming_json: '<em>旧格式</em>' },
      ],
    },
    global: { plugins: [ElementPlus] },
  })

  try {
    await flushPromises()
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0]!.text()).toContain('名称本机歌名来源歌名共享资料')
    expect(rows[1]!.text()).toContain('演唱署名甲、乙丙、丁其他来源')
    expect(rows[2]!.findAll('td').map(cell => cell.text())).toEqual(['0', '205583其他来源'])
    expect(rows[3]!.text()).toContain('别名已清空清空共享资料')
    expect(rows[4]!.text()).toContain('"source": "track-2"')
    expect(rows[5]!.text()).toContain('<em>旧格式</em>')
    expect(rows[5]!.find('em').exists()).toBe(false)

    const edit = wrapper.findAll('button').find(button => button.text() === '订正正式资料')!
    await edit.trigger('click')
    expect(wrapper.emitted('edit')).toEqual([[document]])
  } finally {
    wrapper.unmount()
  }
})
