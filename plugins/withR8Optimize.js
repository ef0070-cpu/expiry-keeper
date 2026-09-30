// Play Console 'R8 최적화' 권장 반영. expo-build-properties로 R8(minify)은 켜져 있지만
// ① 기본 규칙 파일 proguard-android.txt에 -dontoptimize가 들어 있어 최적화가 꺼져 있고
// ② 최적화된 리소스 축소(AGP 8.6+ android.r8.optimizedResourceShrinking)가 꺼져 있다.
// ponytail: 릴리스 빌드에서만 적용 — 최적화로 리플렉션 쓰는 라이브러리가 깨지면 이 플러그인을
// app.json에서 빼면 원래대로(규칙 추가는 proguard-rules.pro / extraProguardRules)
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

module.exports = function withR8Optimize(config) {
  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = c.modResults.contents.replace(
      'getDefaultProguardFile("proguard-android.txt")',
      'getDefaultProguardFile("proguard-android-optimize.txt")',
    );
    return c;
  });
  return withGradleProperties(config, (c) => {
    const key = 'android.r8.optimizedResourceShrinking';
    c.modResults = c.modResults.filter((p) => !(p.type === 'property' && p.key === key));
    c.modResults.push({ type: 'property', key, value: 'true' });
    return c;
  });
};
