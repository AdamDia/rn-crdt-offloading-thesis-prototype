import React from 'react';
import {SafeAreaView, StyleSheet} from 'react-native';

import {BenchmarkScreen} from './src/screens/BenchmarkScreen';

function App(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safe}>
      <BenchmarkScreen />
    </SafeAreaView>
  );
}

export default App;

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#fff'},
});
