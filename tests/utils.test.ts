import { centroid, smoothPath, toClipPath, getAllTags } from '../src/utils';
import { App, TFile } from 'obsidian';

describe('Utils Functions', () => {
    
    describe('centroid', () => {
        it('should calculate the center of a square correctly', () => {
            const points: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
            const center = centroid(points);
            expect(center).toEqual([50, 50]);
        });

        it('should return [50, 50] for empty points', () => {
            expect(centroid([])).toEqual([50, 50]);
        });

        it('should handle single point', () => {
            expect(centroid([[10, 20]])).toEqual([10, 20]);
        });
    });

    describe('toClipPath', () => {
        it('should format polygon string correctly', () => {
            const points: [number, number][] = [[0, 0], [50, 50]];
            const result = toClipPath(points);
            expect(result).toBe('polygon(0% 0%, 50% 50%)');
        });
    });

    describe('smoothPath', () => {
        it('should return simple line path for less than 3 points', () => {
            const points: [number, number][] = [[0, 0], [100, 100]];
            const path = smoothPath(points);
            // Expected: M 0,0 L 100,100 Z
            expect(path).toContain('M 0,0');
            expect(path).toContain('L 100,100');
            expect(path).toContain('Z');
        });

        it('should return curve path for 3 or more points', () => {
            const points: [number, number][] = [[0, 0], [50, 100], [100, 0]];
            const path = smoothPath(points);
            // Should contain Bezier curve command 'C'
            expect(path).toContain('C');
        });
    });

    // Mocking Obsidian App for getAllTags is more complex, 
    // usually done in integration tests or with heavy mocking.
});
