import { describe, expect, it } from 'vitest';
import { fieldsForTransition, missingRequiredFields, selectTransition } from '../src/jira/transitions.js';
import type { JiraTransition } from '../src/jira/types.js';

const transitions: JiraTransition[] = [
  { id: '11', name: 'Geri Al', to: { id: '3', name: 'In Test' } },
  {
    id: '31',
    name: 'Deploy Done',
    to: { id: '10001', name: 'Completed' },
    fields: {
      resolution: { required: true, name: 'Resolution' },
      comment: { required: false, name: 'Comment' },
      labels: { required: true, hasDefaultValue: true, name: 'Labels' },
    },
  },
];

describe('transitions', () => {
  it('geçişi adına göre değil hedef statüye göre seçer (büyük/küçük harf, boşluk toleranslı)', () => {
    expect(selectTransition(transitions, { name: '  completed ' })?.id).toBe('31');
    expect(selectTransition(transitions, { name: 'Deploy Done' })).toBeUndefined();
  });

  it('statü ID verilirse ada bakmaz', () => {
    expect(selectTransition(transitions, { name: 'yanlış ad', id: '10001' })?.id).toBe('31');
    expect(selectTransition(transitions, { name: 'Completed', id: '999' })).toBeUndefined();
  });

  it('varsayılanı olmayan zorunlu alanları tespit eder', () => {
    const t = transitions[1]!;
    expect(missingRequiredFields(t, {})).toEqual(['Resolution (resolution)']);
    expect(missingRequiredFields(t, { resolution: { name: 'Done' } })).toEqual([]);
  });

  it('sadece geçiş ekranındaki alanları gönderir', () => {
    const t = transitions[1]!;
    expect(fieldsForTransition(t, { resolution: { name: 'Done' }, customfield_1: 'x' })).toEqual({
      resolution: { name: 'Done' },
    });
  });
});
