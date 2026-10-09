import { decideUpdate } from './app-update-rule';

const r = { latest_version_code: 32, min_version_code: 30, update_notes: '' };
console.assert(decideUpdate(31, r, 0) === 'optional', '새 버전 있음');
console.assert(decideUpdate(31, r, 32) === 'none', '이 버전은 "나중에" 누름');
console.assert(decideUpdate(31, { ...r, latest_version_code: 33 }, 32) === 'optional', '더 새 버전이면 다시 안내');
console.assert(decideUpdate(29, r, 32) === 'force', '최소 버전 미만은 강제');
console.assert(decideUpdate(32, r, 0) === 'none', '최신');
console.assert(decideUpdate(0, r, 0) === 'none', '버전 못 읽음');
console.assert(decideUpdate(31, { latest_version_code: 0, min_version_code: 0, update_notes: '' }, 0) === 'none', '서버 기본값');
console.log('app-update selfcheck OK');
