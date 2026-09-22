import type { EditState } from '@photo-copilot/domain';

const vertex = `#version 300 es
in vec2 a_position; out vec2 v_uv;
// uv.y 翻转:浏览器 WebGL2 上传 ImageBitmap 时,UNPACK_FLIP_Y_WEBGL 在实测中
// 没有任何效果(四种 flipY 取值结果相同),所以方向纠正放在这里——把 GL
// 的 [0,1] (底→顶) UV 重映射为 [1,0] (顶→底),使画布顶部 = 图像顶部。
void main(){ v_uv=vec2((a_position.x+1.0)*.5, 1.0-(a_position.y+1.0)*.5); gl_Position=vec4(a_position,0.,1.); }`;
// 渲染管线按 docs/COLOR-GRADING.md §5.3 设计:
//   1. 白平衡(warmth/tint) 2. 曝光 3. 区域(高光/阴影)
//   4. 端点(白色色阶/黑色色阶) 5. 清晰度 6. 自然饱和度/饱和度 7. 对比度
// 清晰度采用无邻域采样的中间调对比近似,真正的边缘掩码需要后续扩展。
const fragment = `#version 300 es
precision highp float;
uniform sampler2D u_image; uniform vec2 u_sourceSize; uniform vec2 u_textureSize; uniform vec2 u_output;
uniform float u_exposure,u_contrast,u_highlights,u_shadows,u_whites,u_blacks,u_clarity,u_warmth,u_tint,u_vibrance,u_saturation,u_angle;
uniform vec4 u_crop; uniform int u_count; uniform vec4 u_regions[4]; uniform vec4 u_local[4]; uniform vec4 u_meta[4];
uniform int u_brushCount; uniform vec4 u_brushDabs[128];
in vec2 v_uv; out vec4 outColor;
vec3 decode(vec3 s){return mix(s/12.92,pow((s+.055)/1.055,vec3(2.4)),step(vec3(.04045),s));}
vec3 encode(vec3 c){c=max(c,vec3(0));return clamp(mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c)),0.,1.);}
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 sat(vec3 c,float amount){float y=lum(c);return max(vec3(0),vec3(y)+(1.+amount)*(c-vec3(y)));}
// 自然饱和度:低饱和色获得更多提升,与饱和度叠加。低 chroma 取色均值,
// 等价于在饱和度公式基础上乘上 (1 - chroma) 的 vibrance 加权。
vec3 applyVibrance(vec3 c,float vibrance,float linearSat){
  float mx=max(max(c.r,c.g),c.b), mn=min(min(c.r,c.g),c.b); float chroma=mx-mn;
  float amount=(1.-chroma)*vibrance+linearSat; return sat(c,amount);
}
// 清晰度近似:对中间亮度区域施加对比度加权偏移,避开高光与阴影。
// 注:这是"中间调对比度"而非真正的边缘增强,见 docs/COLOR-GRADING.md §5.3。
vec3 applyClarity(vec3 c,float clarity){
  float y=lum(c); float midMask=1.-abs(2.*y-1.); float adj=clarity*.02;
  vec3 dev=c-vec3(y); dev*=1.+adj*midMask; return max(vec3(0),vec3(y)+dev);
}
vec3 tone(vec3 c,float expv,float high,float saturation){ c*=exp2(expv); float y=clamp(lum(c),0.,1.); float h=smoothstep(.45,.95,y); c*=exp2(high*h); return sat(c,saturation); }
vec3 sampleImage(vec2 uv){
  vec2 texel=1./u_textureSize; vec2 p=uv*u_textureSize-.5; vec2 i=floor(p); vec2 f=fract(p);
  vec2 a=(clamp(i,vec2(0),u_textureSize-1.)+.5)*texel; vec2 b=(clamp(i+vec2(1,0),vec2(0),u_textureSize-1.)+.5)*texel;
  vec2 c=(clamp(i+vec2(0,1),vec2(0),u_textureSize-1.)+.5)*texel; vec2 d=(clamp(i+vec2(1),vec2(0),u_textureSize-1.)+.5)*texel;
  return mix(mix(decode(texture(u_image,a).rgb),decode(texture(u_image,b).rgb),f.x),mix(decode(texture(u_image,c).rgb),decode(texture(u_image,d).rgb),f.x),f.y);
}
void main(){
  // 自动裁切：旋转后选取能够完全落入原裁切区的最大同画幅矩形。
  // x 轴按像素宽高比校正，保证非正方形照片旋转时保持真实几何比例。
  float cs=cos(u_angle),sn=sin(u_angle),absCs=abs(cs),absSn=abs(sn);
  float cropAspect=(u_sourceSize.x*u_crop.z)/(u_sourceSize.y*u_crop.w);
  float autoScale=min(cropAspect/(absCs*cropAspect+absSn),1./(absSn*cropAspect+absCs));
  vec2 centered=(v_uv-.5)*autoScale;
  vec2 visual=vec2(centered.x*cropAspect,centered.y);
  vec2 rotated=vec2(cs*visual.x+sn*visual.y,-sn*visual.x+cs*visual.y);
  vec2 uv=u_crop.xy+u_crop.zw*.5+vec2(rotated.x/cropAspect*u_crop.z,rotated.y*u_crop.w);
  vec3 base=sampleImage(uv); float w=u_warmth,t=u_tint; vec3 gain=vec3(exp2(.25*w),exp2(-.20*t),exp2(-.25*w)); gain/=lum(gain); base*=gain;
  base*=exp2(u_exposure); float y=clamp(lum(base),0.,1.);
  // 区域:高光 / 阴影(已有)
  base*=exp2(u_shadows*(1.-smoothstep(.05,.5,y))+u_highlights*smoothstep(.45,.95,y));
  // 端点:白色色阶(提升高光端)/ 黑色色阶(压低阴影端)。正值 whites 提亮高光,正值 blacks 压黑阴影。
  base*=exp2(u_whites*smoothstep(.85,1.,y)-u_blacks*(1.-smoothstep(0.,.15,y)));
  // 清晰度:中间调对比度加权
  base=applyClarity(base,u_clarity);
  // 自然饱和度 + 线性饱和度
  base=applyVibrance(base,u_vibrance,u_saturation);
  vec3 srgb=encode(base); srgb=clamp(.5+(srgb-.5)*exp2(u_contrast),0.,1.); vec3 global=decode(srgb); vec3 result=global;
  for(int i=0;i<4;i++){
    if(i>=u_count) break;
    vec4 rg=u_regions[i];
    float signedFeather=u_local[i].w; if(abs(signedFeather)<.001) continue;
    float shape=u_meta[i].x; float feather=abs(signedFeather); float mask=0.;
    if(shape<.5){
      vec2 d=(uv-rg.xy)/rg.zw; float dist=length(d);
      mask=1.-smoothstep(1.-feather,1.,dist); if(signedFeather<0.) mask=1.-mask;
    } else if(shape<1.5){
      vec2 direction=vec2(cos(u_meta[i].y),sin(u_meta[i].y));
      float position=dot(uv-rg.xy,direction);
      mask=1.-smoothstep(-feather,feather,position);
    } else {
      for(int b=0;b<128;b++){
        if(b>=u_brushCount) break; vec4 dab=u_brushDabs[b];
        if(abs(dab.w-float(i))>.1) continue;
        float distanceToDab=length(uv-dab.xy);
        mask=max(mask,1.-smoothstep(dab.z*(1.-feather),dab.z,distanceToDab));
      }
    }
    vec3 local=tone(global,u_local[i].x,u_local[i].y,u_local[i].z); result+=mask*(local-global);
  }
  outColor=vec4(encode(clamp(result,0.,1.)),1.);
}`;

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const item = gl.createShader(type)!; gl.shaderSource(item, source); gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item) ?? '着色器编译失败');
  return item;
}
export class PhotoRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private bitmap?: ImageBitmap;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('当前浏览器缺少 WebGL2 支持');
    this.gl = gl; const program = gl.createProgram()!; gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, vertex)); gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? '渲染器初始化失败');
    this.program = program; this.texture = gl.createTexture()!;
    gl.useProgram(program); const buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  async load(blob: Blob) { this.loadBitmap(await createImageBitmap(blob, { imageOrientation: 'from-image' })); }
  loadBitmap(bitmap: ImageBitmap) { this.bitmap?.close(); this.bitmap = bitmap; const gl=this.gl; gl.bindTexture(gl.TEXTURE_2D,this.texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.bitmap); /* FLIP_Y 在本路径无效,方向纠正由 vertex 内的 uv.y 翻转承担 */ }
  render(state: EditState, width = this.canvas.clientWidth, height = this.canvas.clientHeight, pixelRatio = devicePixelRatio || 1) {
    if (!this.bitmap) return; const gl=this.gl; this.canvas.width=Math.max(1,Math.round(width*pixelRatio)); this.canvas.height=Math.max(1,Math.round(height*pixelRatio)); gl.viewport(0,0,this.canvas.width,this.canvas.height); gl.useProgram(this.program);
    const uniform=(name:string)=>gl.getUniformLocation(this.program,name); const g=state.global;
    // 原图尺寸只负责裁切、旋转和蒙版坐标；纹理尺寸只负责像素采样。
    // 预览纹理可以缩小，逻辑编辑坐标仍与原图完全一致。
    gl.uniform2f(uniform('u_sourceSize'),state.sourceWidth,state.sourceHeight); gl.uniform2f(uniform('u_textureSize'),this.bitmap.width,this.bitmap.height); gl.uniform2f(uniform('u_output'),this.canvas.width,this.canvas.height);
    gl.uniform1f(uniform('u_exposure'),g.exposureEV); gl.uniform1f(uniform('u_contrast'),g.contrast/100); gl.uniform1f(uniform('u_highlights'),g.highlights/100); gl.uniform1f(uniform('u_shadows'),g.shadows/100); gl.uniform1f(uniform('u_whites'),g.whites/100); gl.uniform1f(uniform('u_blacks'),g.blacks/100); gl.uniform1f(uniform('u_clarity'),g.clarity/100); gl.uniform1f(uniform('u_warmth'),g.warmth/100); gl.uniform1f(uniform('u_tint'),g.tint/100); gl.uniform1f(uniform('u_vibrance'),g.vibrance/100); gl.uniform1f(uniform('u_saturation'),g.saturation/100);
    gl.uniform1f(uniform('u_angle'),state.transform.angleDeg*Math.PI/180); const c=state.transform.crop; gl.uniform4f(uniform('u_crop'),c.x,c.y,c.width,c.height); gl.uniform1i(uniform('u_count'),state.regions.length);
    const regions=new Float32Array(16), locals=new Float32Array(16), meta=new Float32Array(16), brushDabs=new Float32Array(128 * 4); let brushCount=0;
    state.regions.forEach((region,index)=>{
      const j=index*4;
      regions.set([region.centerX,region.centerY,region.radiusX,region.radiusY],j);
      const signedFeather=region.enabled && (region.shape !== 'brush' || region.brushDabs.length > 0) ? (region.mode==='outside' && region.shape==='ellipse' ? -region.feather : region.feather) : 0;
      locals.set([region.adjustments.exposureEV,region.adjustments.highlights/100,region.adjustments.saturation/100,signedFeather],j);
      meta.set([region.shape === 'ellipse' ? 0 : region.shape === 'linear' ? 1 : 2, region.angleDeg * Math.PI / 180, region.brushRadius, 0],j);
      if(region.shape === 'brush') for(const dab of region.brushDabs) {
        if(brushCount >= 128) break;
        brushDabs.set([dab.x,dab.y,region.brushRadius,index],brushCount * 4); brushCount++;
      }
    });
    gl.uniform4fv(uniform('u_regions'),regions); gl.uniform4fv(uniform('u_local'),locals); gl.uniform4fv(uniform('u_meta'),meta); gl.uniform1i(uniform('u_brushCount'),brushCount); gl.uniform4fv(uniform('u_brushDabs'),brushDabs); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  async analysisBlob(state: EditState, maxEdge=1024) { const width=this.bitmap!.width, height=this.bitmap!.height, scale=Math.min(1,maxEdge/Math.max(width,height)); const canvas=document.createElement('canvas'); canvas.width=Math.round(width*scale); canvas.height=Math.round(height*scale); const renderer=new PhotoRenderer(canvas); await renderer.load(await this.toBlob()); renderer.render({ ...state, transform: { ...state.transform, angleDeg: 0, crop: {x:0,y:0,width:1,height:1} } },canvas.width,canvas.height); return new Promise<Blob>((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error('缩略图编码失败')),'image/jpeg',.85)); }
  // 浏览器负责图片编码；若格式不受支持，canvas 会退回 PNG，这里直接报错以避免文件扩展名与真实内容不一致。
  toBlob(quality=.92, type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' = 'image/jpeg') {
    return new Promise<Blob>((resolve,reject)=>this.canvas.toBlob((blob)=>{
      if (!blob) { reject(new Error('图片编码失败')); return; }
      if (blob.type !== type) { reject(new Error(`当前浏览器不支持 ${type.replace('image/', '').toUpperCase()} 导出`)); return; }
      resolve(blob);
    },type,type === 'image/png' ? undefined : quality));
  }
  /** 读取顶端朝上的 RGBA 像素，用于交给 TIFF 等无损编码器。 */
  rgbaPixels() {
    const bottomUp = new Uint8Array(this.canvas.width * this.canvas.height * 4);
    this.gl.readPixels(0, 0, this.canvas.width, this.canvas.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, bottomUp);
    const topDown = new Uint8Array(bottomUp.length);
    const rowLength = this.canvas.width * 4;
    for (let y = 0; y < this.canvas.height; y += 1) {
      topDown.set(bottomUp.subarray((this.canvas.height - y - 1) * rowLength, (this.canvas.height - y) * rowLength), y * rowLength);
    }
    return topDown;
  }
  dispose(){ this.bitmap?.close(); this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program); }
}
