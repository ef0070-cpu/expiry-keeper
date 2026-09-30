// PreToolUse 보안 훅: 되돌릴 수 없는 명령과 비밀 파일 접근을 실행 전에 막는다.
// Claude Code가 도구 호출 정보를 JSON으로 stdin에 넘긴다. 막을 땐 exit 2 + stderr 사유.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw).tool_input || {};
  } catch {
    process.exit(0); // 해석 못 하면 막지 않는다(권한 목록이 1차 방어)
  }
  const text = [input.command, input.file_path, input.path].filter(Boolean).join(' ');
  const rules = [
    [/git\s+push\b.*(--force\b|\s-f\b|--force-with-lease)/, '강제 푸시'],
    [/git\s+reset\s+--hard/, 'git reset --hard'],
    [/rm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i, 'rm -rf'],
    [/(^|[\\/\s'"])\.env(\.(local|production|development))?($|[\s'"])/i, '.env 비밀 파일'],
    [/service[_-]?role/i, 'Supabase service role 키'],
  ];
  for (const [re, why] of rules) {
    if (re.test(text)) {
      process.stderr.write(`보안 훅이 막음: ${why} — 필요하면 사용자가 직접 실행하세요.\n`);
      process.exit(2);
    }
  }
  process.exit(0);
});
