import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './src/lib/auth';
import { PairScreen } from './src/screens/PairScreen';
import { TablesScreen } from './src/screens/TablesScreen';
import { OrderScreen } from './src/screens/OrderScreen';
import { BillScreen } from './src/screens/BillScreen';
import { StockScreen } from './src/screens/StockScreen';
import type { AppStackParamList } from './src/lib/navigation';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
    mutations: { retry: false },
  },
});

const AuthStack = createNativeStackNavigator<{ Pair: undefined }>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

/**
 * Two disjoint navigators: when unpaired we only want the pair screen to
 * exist in the stack so there is no way to back-navigate into an
 * authenticated route. When paired, the pair screen is unreachable.
 * Splitting them also means a sign-out completely tears down the
 * authenticated stack's screen state.
 */
function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Pair" component={PairScreen} />
    </AuthStack.Navigator>
  );
}

function AppFlow() {
  return (
    <AppStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#fff',
        headerTitleStyle: { color: '#fff' },
        contentStyle: { backgroundColor: '#0f172a' },
      }}
    >
      <AppStack.Screen
        name="Tables"
        component={TablesScreen}
        options={{ headerShown: false }}
      />
      <AppStack.Screen name="Order" component={OrderScreen} />
      <AppStack.Screen name="Bill" component={BillScreen} />
      <AppStack.Screen name="Stock" component={StockScreen} />
    </AppStack.Navigator>
  );
}

function RootNavigator() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return state.status === 'authenticated' ? <AppFlow /> : <AuthFlow />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NavigationContainer>
            <RootNavigator />
            <StatusBar style="light" />
          </NavigationContainer>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
});
