import { describe, expect, it } from 'vitest';
import { priorityScore, rankWorkCandidates } from './operationsDashboard.js';

describe('operational priority definition', () => {
  it('is deterministic, bounded, and explainable', () => {
    expect(priorityScore(80, 90)).toEqual({ score: 110, explanation: '80 rule weight + 30 age points' });
    expect(priorityScore(50, -2)).toEqual({ score: 50, explanation: '50 rule weight + 0 age points' });
  });
});

const row = (id: string, age: number) => ({ subject_kind: 'item', subject_id: id,
  subject_public_id: `RV-${id}`, display_name: id, created_at: new Date(Date.UTC(2026, 0, 31 - age)).toISOString() });

describe('operational candidate ranking', () => {
  const now = Date.UTC(2026, 0, 31);

  it('returns the global top 20 from independently bounded rule sets', () => {
    const photos = Array.from({ length: 20 }, (_, i) => row(`photo-${i}`, 30));
    const tasks = rankWorkCandidates([row('location', 20)], photos, now);
    expect(tasks).toHaveLength(20);
    expect(tasks[0]).toMatchObject({ subjectId: 'location', score: 100, destination: '/inventory/current?needsLocation=1' });
    expect(tasks.filter(task => task.taskType === 'missing_media')).toHaveLength(19);
  });

  it('keeps both tasks for a dual exception without hiding a higher priority candidate', () => {
    const dual = row('dual', 10);
    const tasks = rankWorkCandidates([dual, row('older-location', 30)], [dual], now);
    expect(tasks.map(task => `${task.taskType}:${task.subjectId}`)).toEqual([
      'missing_location:older-location', 'missing_location:dual', 'missing_media:dual',
    ]);
    expect(tasks[2].destination).toBe('/inventory/current?needsPhotos=1');
  });
});
