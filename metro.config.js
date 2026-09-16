const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// 홈 디렉터리 최상단에 .git/package-lock.json이 있어 Metro가 그걸 모노레포 루트로
// 오인해 전체 홈 폴더를 watch하려다 타임아웃나는 문제를 막기 위함.
process.env.EXPO_NO_METRO_WORKSPACE_ROOT = '1';

const config = getDefaultConfig(__dirname);

// .claude/worktrees 아래 다른 작업용 git worktree의 node_modules가 깨져있어
// (디렉터리가 사라진 상태로 남은 항목들) watch 시도 중 ENOENT로 서버가 죽는 문제를 막기 위함.
config.resolver.blockList = [/\.claude[\\/]worktrees/].concat(config.resolver.blockList ?? []);

module.exports = withNativeWind(config, { input: './src/global.css' });
