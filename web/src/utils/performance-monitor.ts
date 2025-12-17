/**
 * 性能监测脚本
 * 用于验证虚拟列表优化的实际效果
 *
 * 使用方法：在浏览器控制台粘贴这段代码，打开聊天界面并滚动
 */

// 1. 监测 DOM 节点数量
function measureDOMNodes() {
  const messageItems = document.querySelectorAll('[class*="message"]');
  return messageItems.length;
}

// 2. 监测内存占用
function measureMemory() {
  if (!performance.memory) {
    console.warn('Memory API not available');
    return null;
  }
  return {
    usedJSHeapSize:
      (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
    totalJSHeapSize:
      (performance.memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB',
    limit: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB',
  };
}

// 3. 监测滚动性能 (FPS)
class FPSMonitor {
  constructor() {
    this.fps = 0;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.animate();
  }

  animate() {
    const currentTime = performance.now();
    this.frameCount++;

    if (currentTime >= this.lastTime + 1000) {
      this.fps = Math.round(
        (this.frameCount * 1000) / (currentTime - this.lastTime),
      );
      this.frameCount = 0;
      this.lastTime = currentTime;
    }

    requestAnimationFrame(() => this.animate());
  }

  getFPS() {
    return this.fps;
  }
}

// 4. 统计性能数据
function collectMetrics() {
  const fpsMonitor = new FPSMonitor();

  const metricsInterval = setInterval(() => {
    const domNodes = measureDOMNodes();
    const memory = measureMemory();
    const fps = fpsMonitor.getFPS();

    console.group('📊 聊天列表性能指标');
    console.log(`⏱️  FPS: ${fps}`);
    console.log(`📦 DOM 节点数: ${domNodes}`);
    if (memory) {
      console.log(
        `💾 内存占用: ${memory.usedJSHeapSize} / ${memory.totalJSHeapSize}`,
      );
      console.log(`   堆限制: ${memory.limit}`);
    }
    console.groupEnd();
  }, 3000);

  return metricsInterval;
}

// 5. 启动监测
console.log('🚀 启动性能监测...');
console.log('💡 性能数据将每 3 秒输出一次');
console.log('💡 滚动聊天窗口以观察 FPS 变化');

const metricsInterval = collectMetrics();

// 停止监测
console.log('❌ 要停止监测，执行: clearInterval(metricsInterval)');

// 预期性能指标
console.log('\n📈 预期性能提升:');
console.log('  • DOM 节点数: 500+ → 10-20（虚拟化）');
console.log('  • 滚动 FPS: 30 → 55+（平滑）');
console.log('  • 内存占用: 减少 70-80%');
