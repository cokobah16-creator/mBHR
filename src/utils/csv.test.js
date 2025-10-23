import { describe, it, expect } from 'vitest';
import { arrayToCSV, downloadCSV } from './csv';
describe('CSV Utilities', () => {
    describe('arrayToCSV', () => {
        it('should convert array of objects to CSV', () => {
            const data = [
                { name: 'John', age: 30, city: 'Lagos' },
                { name: 'Jane', age: 25, city: 'Abuja' },
            ];
            const csv = arrayToCSV(data);
            expect(csv).toContain('name,age,city');
            expect(csv).toContain('John,30,Lagos');
            expect(csv).toContain('Jane,25,Abuja');
        });
        it('should handle empty array', () => {
            const csv = arrayToCSV([]);
            expect(csv).toBe('');
        });
        it('should escape commas in values', () => {
            const data = [
                { name: 'John, Jr.', city: 'Lagos, Nigeria' },
            ];
            const csv = arrayToCSV(data);
            expect(csv).toContain('"John, Jr."');
            expect(csv).toContain('"Lagos, Nigeria"');
        });
        it('should escape quotes in values', () => {
            const data = [
                { note: 'Patient said "feeling better"' },
            ];
            const csv = arrayToCSV(data);
            expect(csv).toContain('Patient said ""feeling better""');
        });
        it('should handle null and undefined values', () => {
            const data = [
                { name: 'John', age: null, city: undefined },
            ];
            const csv = arrayToCSV(data);
            expect(csv).toContain('John,,');
        });
        it('should handle boolean values', () => {
            const data = [
                { name: 'John', active: true, verified: false },
            ];
            const csv = arrayToCSV(data);
            expect(csv).toContain('John,true,false');
        });
        it('should handle nested objects', () => {
            const data = [
                { name: 'John', address: { city: 'Lagos' } },
            ];
            const csv = arrayToCSV(data);
            expect(csv).toContain('[object Object]');
        });
    });
    describe('downloadCSV', () => {
        it('should create download link', () => {
            const data = [
                { name: 'John', age: 30 },
            ];
            const createElementSpy = vi.spyOn(document, 'createElement');
            const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => null);
            const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => null);
            downloadCSV(data, 'test.csv');
            expect(createElementSpy).toHaveBeenCalledWith('a');
            expect(appendChildSpy).toHaveBeenCalled();
            expect(removeChildSpy).toHaveBeenCalled();
            createElementSpy.mockRestore();
            appendChildSpy.mockRestore();
            removeChildSpy.mockRestore();
        });
    });
});
