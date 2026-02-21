// TypeScript module resolution helper for NodeNext:
// Allows importing `./foo.js` where source is `./foo.ts` (emitted as .js).

// kuroshiro / kuroshiro-analyzer-kuromoji은 타입 선언이 없음 → any로 선언
declare module 'kuroshiro';
declare module 'kuroshiro-analyzer-kuromoji';
