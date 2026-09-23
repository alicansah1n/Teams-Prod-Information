import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config.js';
import { TEST_ENV } from './helpers.js';

describe('config', () => {
  it('varsayılanlar, defaults ve proje ayarlarını sırayla birleştirir', () => {
    const config = createConfig(TEST_ENV, {
      defaults: { addComment: false },
      projects: { oe: { displayName: 'Özel Entegratörlük', targetStatus: 'Done' } },
    });
    expect(config.projectKeys).toEqual(['OE']);
    const pc = config.project('OE');
    expect(pc).toMatchObject({ displayName: 'Özel Entegratörlük', sourceStatus: 'To be Deployed', targetStatus: 'Done', addComment: false });
    expect(config.project('XYZ').targetStatus).toBe('Completed');
  });

  it('eksik .env değerleri için anlaşılır hata', () => {
    expect(() => createConfig({ ...TEST_ENV, JIRA_API_TOKEN: '' }, { projects: {} })).toThrow(/JIRA_API_TOKEN/);
    expect(() => createConfig({ ...TEST_ENV, TZ_NAME: 'Mars/Base' }, { projects: {} })).toThrow(/saat dilimi/);
  });
});
