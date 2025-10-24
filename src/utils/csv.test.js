import { describe, it, expect } from 'vitest';
import { toCsv, download } from './csv';
describe('CSV Utilities', () => {
    describe('toCsv', () => {
        it('should convert array of objects to CSV', () => {
            const data = [
                { name: 'John', age: 30, city: 'Lagos' },
                { name: 'Jane', age: 25, city: 'Abuja' },
            ];
            const csv = toCsv(data);
            expect(csv).toContain('name,age,city');
            expect(csv).toContain('John,30,Lagos');
            expect(csv).toContain('Jane,25,Abuja');
        });
        it('should handle empty array', () => {
            const csv = toCsv([]);
            expect(csv).toBe('');
        });
        it('should escape commas in values', () => {
            const data = [
                { name: 'John, Jr.', city: 'Lagos, Nigeria' },
            ];
            const csv = toCsv(data);
            expect(csv).toContain('"John, Jr."');
            expect(csv).toContain('"Lagos, Nigeria"');
        });
        it('should escape quotes in values', () => {
            const data = [
                { note: 'Patient said "feeling better"' },
            ];
            const csv = toCsv(data);
            expect(csv).toContain('Patient said ""feeling better""');
        });
        it('should handle null and undefined values', () => {
            const data = [
                { name: 'John', age: null, city: undefined },
            ];
            const csv = toCsv(data);
            expect(csv).toContain('John,,');
        });
        it('should handle boolean values', () => {
            const data = [
                { name: 'John', active: true, verified: false },
            ];
            const csv = toCsv(data);
            expect(csv).toContain('John,true,false');
        });
        it('should handle nested objects', () => {
            const data = [
                { name: 'John', address: { city: 'Lagos' } },
            ];
            const csv = toCsv(data);
            expect(csv).toContain('[object Object]');
        });
    });
    describe('download', () => {
        it('should create download link', () => {
            const data = [
                { name: 'John', age: 30 },
            ];

            // Mock URL.createObjectURL and revokeObjectURL
            const mockUrl = 'blob:mock-url';
            global.URL.createObjectURL = vi.fn(() => mockUrl);
            global.URL.revokeObjectURL = vi.fn();

            const createElementSpy = vi.spyOn(document, 'createElement');
            const clickSpy = vi.fn();

            // Mock the anchor element
            const mockAnchor = {
                href: '',
                download: '',
                click: clickSpy
            };
            createElementSpy.mockReturnValue(mockAnchor);

            const csv = toCsv(data);
            download('test.csv', csv);

            expect(createElementSpy).toHaveBeenCalledWith('a');
            expect(clickSpy).toHaveBeenCalled();
            expect(mockAnchor.download).toBe('test.csv');

            createElementSpy.mockRestore();
        });
    });
});
