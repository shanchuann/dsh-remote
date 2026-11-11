import '../../global.css';

/**
 * Root layout: gesture handler + safe area + the expo-router stack.
 *
 * The chat route (session/[id]) is owned by app-chat; it draws its own header,
 * so the stack header is hidden globally. Colors come from the uniwind theme
 * tokens (src/styles/theme.css) so light and dark both work.
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useResolveClassNames, useUniwind } from 'uniwind';

import { useRemoteStore } from '../lib/store';

export default function RootLayout() {
  const { theme } = useUniwind();
  const { backgroundColor } = useResolveClassNames('bg-background');
  const background = typeof backgroundColor === 'string' ? backgroundColor : '#0e0f13';

  // Re-validate the link and re-open the active session when coming back from
  // the background (protocol 6.3).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useRemoteStore.getState().actions.resume();
    });
    return () => subscription.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }}>
      <SafeAreaProvider>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'fade' }} />
          <Stack.Screen name="sessions" options={{ animation: 'fade' }} />
          <Stack.Screen name="settings" />
          <Stack.Screen name="pair" options={{ animation: 'fade' }} />
          <Stack.Screen name="session/[id]" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}