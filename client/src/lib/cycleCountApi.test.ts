import {describe,it,expect} from 'vitest';import {isBlindPass} from './cycleCountApi';
describe('cycle count disclosure',()=>{it('keeps every active pass blind',()=>{expect(isBlindPass('in_progress')).toBe(true);expect(isBlindPass('review')).toBe(false)})});
