/**
 * Deep-link entry point for dshremote://pair?u=...&c=...&h=...&n=...
 *
 * Expo Router maps the URI path to this route; it forwards every query param to
 * the connect screen so a scanned/pasted link prefills the pairing form instead
 * of showing the unmatched-route page.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import { useRemoteStore } from '../lib/store';

export default function PairDeepLink() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();

  // Stable, serialisable key so the redirect runs once per distinct payload.
  const forwarded = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') next[key] = value;
      else if (Array.isArray(value) && typeof value[0] === 'string') next[key] = value[0];
    }
    return next;
  }, [params]);
  const payloadKey = JSON.stringify(forwarded);

  useEffect(() => {
    const payload = JSON.parse(payloadKey) as Record<string, string>;
    if (payload.u) {
      // A deep link is an explicit intent to (re)connect to that host.
      useRemoteStore.getState().actions.clearError();
      router.replace({ pathname: '/', params: payload });
      return;
    }
    router.replace('/');
  }, [payloadKey]);

  return <View className="flex-1 bg-background" />;
}
