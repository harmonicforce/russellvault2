import { describe, expect, it } from 'vitest';
import { priorityScore } from './operationsDashboard.js';

describe('operational priority definition', () => {
  it('is deterministic, bounded, and explainable', () => {
    expect(priorityScore(80, 90)).toEqual({ score: 110, explanation: '80 rule weight + 30 age points' });
    expect(priorityScore(50, -2)).toEqual({ score: 50, explanation: '50 rule weight + 0 age points' });
  });
});
