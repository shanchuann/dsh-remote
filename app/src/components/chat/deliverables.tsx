import { Pressable, Text, View } from 'react-native';
import { isImagePath } from '../../lib/session-files';
import { RemoteImage, useSessionFiles } from './session-files';
export function Deliverables({ files, title = "交付文件" }: { title?: string; files: { path: string; label?: string }[] }) {
  const { open } = useSessionFiles();
  return <View className="mx-4 my-2 gap-2 rounded-2xl border border-border bg-surface p-3">
    <Text className="text-sm font-medium text-foreground">{title}</Text>
    {files.map((file, i) => <View key={file.path + i}>
      {isImagePath(file.path) ? <RemoteImage image={{ url: file.path, name: file.label }} /> : null}
      <Pressable accessibilityRole="button" onPress={() => open(file.path)} className="min-h-12 justify-center py-2"><Text className="text-sm leading-5 text-primary">{file.label ?? file.path.split(/[\\/]/).pop()}</Text><Text numberOfLines={2} className="text-xs text-muted">{file.path}</Text></Pressable>
    </View>)}
  </View>;
}
