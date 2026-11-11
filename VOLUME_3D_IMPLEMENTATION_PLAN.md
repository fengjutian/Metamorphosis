# Metamorphosis Volume：真实 3D Volume 移植方案

## 1. 目标

将 Shadertoy 的三个原始 Pass 在 React + WebGL2 中本地运行：

```text
Volume Pass（128³）
        ↓
Scene Pass（体积、水面、天空、深度）
        ↓
Image Pass（景深、Bloom、雾、God Rays、调色）
        ↓
React Canvas
```

视觉目标以用户提供的原始截图为准：

- 外圈花瓣宽阔并水平展开；
- 内圈花瓣圆润、层叠，而不是尖刺或噪声团；
- 花瓣具有柔和的粉白渐变和逆光透射；
- 中心可见暖黄色或黄绿色花托；
- 水面反射、景深和大气雾保持柔和；
- 不允许出现旧球体外壳、Atlas 切片串色或体素碎裂。

## 2. 为什么不再使用二维 Atlas

此前将体积切片排列到二维纹理：

```text
128 张 128×128 切片
→ 16×8 Atlas
→ 2048×1024 二维纹理
```

该方案虽然可以一次更新大量体素，但与 Shadertoy 的真实三维纹理存在差异：

- 三维纹理过滤需要自行模拟；
- 切片边缘可能发生插值串色；
- Z 插值与原生 `sampler3D` 不完全一致；
- 自反馈距离传播的时序被改变；
- 为性能加入的目标场缓存和冻结逻辑会改变收敛结果；
- 花瓣薄表面容易被错误距离或大步行进越过。

因此正式方案删除二维 Atlas，使用 WebGL2 原生 `TEXTURE_3D`。

## 3. 正式架构

### 3.1 Volume Ping-Pong

创建两张相同尺寸的三维浮点纹理：

```text
Volume A：RGBA16F，128×128×128
Volume B：RGBA16F，128×128×128
```

两者交替读写：

```text
第 N 次更新：   A → B
第 N+1 次更新： B → A
```

每个纹理包含：

```text
R：有符号距离或体积场
GBA：保留
```

距离含义：

```text
distance > 0    形状外部
distance = 0    形状表面
distance < 0    形状内部
```

### 3.2 逐层写入三维纹理

WebGL2 Fragment Shader 无法在一次绘制中写入整个三维纹理，因此对每一个 Z 层执行一次绘制：

```js
for (let layer = 0; layer < volumeSize; layer++) {
  gl.framebufferTextureLayer(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    destinationVolume,
    0,
    layer,
  );

  gl.uniform1f(uLayer, layer);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
```

Volume Fragment Shader 根据二维像素和当前层恢复三维体素坐标：

```glsl
ivec3 voxel = ivec3(
    ivec2(gl_FragCoord.xy),
    int(uLayer)
);
```

这对应 Shadertoy 的：

```glsl
void mainVolume(out vec4 color, vec3 voxel)
```

### 3.3 三维邻域读取

上一轮 Volume 使用真正的三维采样器：

```glsl
uniform highp sampler3D uPrevious;
```

邻居使用三维 `texelFetch`：

```glsl
float previous(ivec3 voxel)
{
    voxel = clamp(voxel, ivec3(0), ivec3(volumeSize - 1));
    return texelFetch(uPrevious, voxel, 0).r;
}
```

距离传播检查当前体素周围的 26 个邻居：

```glsl
for (int k = 0; k < 27; k++) {
    if (k == 13) continue;

    ivec3 offset = ivec3(
        k % 3,
        (k / 3) % 3,
        k / 9
    ) - 1;

    float value = previous(voxel + offset);
}
```

### 3.4 原生三线性采样

Scene Pass 直接声明：

```glsl
uniform highp sampler3D uVolume;
```

空间坐标从 `[-1, 1]` 转换到 `[0, 1]`：

```glsl
float volumeSample(vec3 position)
{
    vec3 uvw = clamp(position * 0.5 + 0.5, 0.0, 1.0);
    return texture(uVolume, uvw).r;
}
```

纹理过滤设置为：

```js
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
```

这样 XYZ 三个方向都由 GPU 原生完成线性插值。

## 4. 三个 Pass 的职责

### 4.1 Volume Pass

必须保留原始算法：

- `gradientAt()`；
- `cornerValue()`；
- `perlinAbs()`；
- 六层 `turbulence()`；
- `ellipsoid()`；
- 五圈 `petalRing()`；
- 莲花中心花托；
- 球体到莲花的形变；
- 26 邻居距离传播。

不再使用 value noise 或自行设计的莲花参数。

### 4.2 Scene Pass

必须保留：

- 八个相机关键帧；
- Catmull–Rom 相机路径；
- 相机位置、目标和 roll 抖动；
- box intersection；
- 外部 sphere tracing；
- 内部固定步长体积积分；
- Beer–Lambert 透射率；
- 距离场中心差分法线；
- 花瓣材质、逆光透射、Fresnel 和高光；
- 水面 swell、ripple 和同心环；
- 水面中的二次体积反射；
- Alpha 深度；
- `(0,0)` 特殊太阳元数据像素。

### 4.3 Image Pass

必须保留：

- Karis 预过滤；
- RGB 色差；
- 深度感知景深；
- 黄金角 Bloom；
- 程序化大气雾；
- 太阳 God Rays；
- Reinhard 色调映射；
- Gamma 校正；
- 冷阴影、暖高光；
- 暗角、颗粒和 2.35:1 遮幅。

## 5. 分辨率档位

保留三个档位：

```text
32³：只用于快速编译和管线诊断
64³：交互预览
128³：原始质量和最终验收
```

URL：

```text
32³：  ?volume=32
64³：  ?volume=64
128³： ?volume=128
```

固定莲花和镜头：

```text
?volume=128&morph=1&time=20&clean=1
```

## 6. 性能预算

`128³` 包含：

```text
128 × 128 × 128 = 2,097,152 个体素
```

每轮 Volume 更新需要：

```text
128 次 framebuffer layer 绘制
约 210 万次 Fragment Shader 调用
每体素最多 6 层 Perlin 与 26 邻居读取
```

因此：

- 首帧生成可能较慢；
- 初始距离传播需要多轮更新；
- 软件 WebGL 不适合运行 128³；
- 128³ 应使用独立显卡测试；
- 不能为了速度再次改变 SDF 或采样语义。

可接受的优化必须不改变画面：

- 形态稳定且距离场收敛后冻结 Volume；
- Scene/Post 降低屏幕分辨率；
- Bloom 和 God Rays 使用低分辨率缓冲；
- 使用 GPU timer query 调节屏幕比例；
- 不得重新引入 Atlas 或近似噪声。

## 7. 验收基准

### 7.1 固定对比条件

```text
volume = 128
morph = 1
time = 20
clean = 1
```

地址：

```text
http://127.0.0.1:5173/?volume=128&morph=1&time=20&clean=1
```

### 7.2 花瓣验收

- 外圈花瓣宽阔并接近水平；
- 第二圈与外圈错开；
- 内圈花瓣向上聚拢但保持圆润；
- 花瓣之间有清晰分层，不合并为球体；
- 不出现锯齿切片、孔洞、尖刺或噪声爆炸；
- 花朵中心位置和整体比例与参考截图一致。

### 7.3 材质验收

- 花瓣根部接近白色或浅黄色；
- 花瓣尖端为柔和粉色；
- 逆光区域具有半透明感；
- 不出现大面积纯紫色噪声；
- 景深只柔化离焦区域，不破坏轮廓。

### 7.4 场景验收

- 花朵位于水面上方；
- 水面倒影可见但不抢主体；
- 天空具有暖色地平线和冷色上空；
- 对照模式不显示 React UI。

## 8. 当前状态

已完成：

- React + Vite 页面；
- WebGL2 三阶段管线；
- 两张真实三维浮点纹理；
- 逐层 framebuffer 写入；
- Volume ping-pong；
- 原生 `sampler3D` 采样；
- 32³ 软件 WebGL 实际渲染验证；
- 64³、128³ 运行入口；
- 固定 morph、time 和 clean 对照参数。

仍需重点验证：

- 128³ 在目标显卡上的完整收敛时间；
- 固定第 20 秒画面与原始截图的逐项差异；
- 花瓣材质、景深和大气强度是否完全一致；
- 动态形变期间三维距离场是否保持稳定。

## 9. 相关文件

```text
src/shaders.js
    Volume、Scene、Image GLSL

src/renderer.js
    TEXTURE_3D、framebuffer layer、ping-pong 和 Pass 调度

src/main.jsx
    React 控制界面、URL 参数和 clean 模式

README.md
    使用说明与项目概览
```

