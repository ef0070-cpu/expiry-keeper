import { File, Paths } from 'expo-file-system';
import { EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import { parseCsvLines } from './csv-import';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 엑셀 템플릿(base64)을 기기에 남긴다. Android는 공유 시트로 보내면 고른 앱이 저장을 안 할 때
 * 파일이 안 남아서, 사용자가 고른 폴더에 직접 쓴다. 처음 보여 줄 폴더는 문서(Documents) —
 * 다운로드 폴더 자체는 Android가 앱 접근을 막아 '이 폴더를 사용할 수 없음'이 뜬다. */
export async function saveXlsxTemplate(name: string, base64: string): Promise<void> {
  if (Platform.OS === 'android') {
    const hint = StorageAccessFramework.getUriForDirectoryInRoot('Documents');
    const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync(hint);
    if (!perm.granted) return;
    const uri = await StorageAccessFramework.createFileAsync(perm.directoryUri, name, XLSX_MIME);
    await StorageAccessFramework.writeAsStringAsync(uri, base64, { encoding: EncodingType.Base64 });
    Alert.alert('저장 완료', '선택한 폴더에 엑셀 템플릿을 저장했어요.');
    return;
  }
  const file = new File(Paths.cache, `${name}.xlsx`);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('공유 불가', '이 기기에서는 파일 공유를 지원하지 않아요.');
    return;
  }
  await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME });
}

/** 고른 파일(.xlsx 또는 .csv)을 행 목록으로 읽는다. 엑셀 파서는 필요할 때만 불러온다. */
export async function readPickedRows(asset: { uri: string; name?: string | null }): Promise<string[][]> {
  const file = new File(asset.uri);
  const name = (asset.name ?? asset.uri).toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const { readSpreadsheetRows } = await import('./xlsx-io');
    return readSpreadsheetRows(await file.bytes());
  }
  return parseCsvLines(await file.text());
}
