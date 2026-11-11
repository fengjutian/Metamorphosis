const vertexShader = `#version 300 es
in vec2 position;
void main(){ gl_Position=vec4(position,0.,1.); }`;

const fragmentShader = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMorph;
#define PI 3.14159265359

float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float n=dot(i,vec3(1.,57.,113.));
  return mix(mix(mix(hash21(vec2(n,n)),hash21(vec2(n+1.,n)),f.x),mix(hash21(vec2(n+57.,n)),hash21(vec2(n+58.,n)),f.x),f.y),mix(mix(hash21(vec2(n+113.,n)),hash21(vec2(n+114.,n)),f.x),mix(hash21(vec2(n+170.,n)),hash21(vec2(n+171.,n)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+1.7;a*=.5;} return s; }
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float sdEllipsoid(vec3 p, vec3 r){float k0=length(p/r),k1=length(p/(r*r));return k0*(k0-1.)/max(k1,.001);}

float petalRing(vec3 p,float count,float phase,float radius,float y,float tilt,float len,float wid,float thick,float bend){
  float ang=atan(p.z,p.x)-phase;
  float sec=2.*PI/count;
  float a=mod(ang+.5*sec,sec)-.5*sec;
  vec3 q=vec3(length(p.xz)*cos(a)-radius,p.y-y,length(p.xz)*sin(a));
  q.xy=rot(tilt)*q.xy;
  q.y-=bend*q.x*q.x+2.2*q.z*q.z;
  return sdEllipsoid(q-vec3(len*.5,0,0),vec3(len*.5,thick,wid));
}
float lotus(vec3 p){
  p.y+=.48;
  float d=1e4;
  d=min(d,petalRing(p,9.,0.,.10,0.,.42,.92,.19,.075,.28));
  d=min(d,petalRing(p,9.,.35,.10,.03,.72,.90,.175,.071,.34));
  d=min(d,petalRing(p,8.,0.,.11,.06,.96,.84,.16,.068,.42));
  d=min(d,petalRing(p,7.,.45,.12,.09,1.17,.72,.145,.064,.52));
  d=min(d,petalRing(p,6.,0.,.14,.12,1.38,.55,.115,.06,.58));
  vec3 c=p-vec3(0,.28,0); d=min(d,length(c/vec3(1.,.35,1.))-.105);
  return d;
}
float map(vec3 p){
  float n=(fbm(p*2.8+uTime*.025)-.5)*.22;
  float orb=length(p)-.62+n*(1.-uMorph);
  float flower=lotus(p)+n*.15;
  return mix(orb,flower,smoothstep(0.,1.,uMorph));
}
vec3 normal(vec3 p){vec2 e=vec2(.003,0);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
vec3 sky(vec3 rd){
  vec3 sun=normalize(vec3(-.72,.42,.53)); float h=max(rd.y,0.);
  vec3 c=mix(vec3(.96,.36,.19),vec3(.035,.08,.22),pow(h,.45));
  float s=max(dot(rd,sun),0.); c+=vec3(1.,.42,.15)*(pow(s,9.)*.5+pow(s,350.)*8.);
  return c;
}
vec3 material(vec3 p,vec3 n,vec3 rd){
  vec3 sun=normalize(vec3(-.72,.42,.53)); float dif=max(dot(n,sun),0.); float wrap=pow(.5+.5*dot(n,sun),2.);
  vec3 orb=mix(vec3(.24,.015,.025),vec3(1.,.24,.07),p.y+.55);
  float tip=clamp(length(p.xz)*.9+(p.y+.48)*.6,0.,1.);
  vec3 pet=mix(vec3(1.,.82,.75),vec3(.92,.08,.31),smoothstep(.15,.9,tip));
  vec3 alb=mix(orb,pet,uMorph); vec3 h=normalize(sun-rd);
  float spec=pow(max(dot(n,h),0.),70.); float fre=pow(1.-max(dot(n,-rd),0.),3.);
  return alb*(vec3(1.,.72,.52)*(dif*1.3+wrap*.35)+vec3(.035,.075,.13)) + spec*vec3(1.,.65,.4)*.7 + fre*sky(reflect(rd,n))*.28;
}
vec3 traceObject(vec3 ro,vec3 rd,out float hit,out float travel){
  float t=0.; hit=0.;
  for(int i=0;i<110;i++){vec3 p=ro+rd*t;float d=map(p);if(d<.0025){hit=1.;travel=t;vec3 n=normal(p);vec3 c=material(p,n,rd);float glow=exp(-18.*abs(d));return c+vec3(.8,.12,.08)*glow*.06;}t+=max(d*.65,.006);if(t>9.)break;}
  travel=t; return vec3(0);
}
void main(){
  vec2 uv=(2.*gl_FragCoord.xy-uResolution.xy)/uResolution.y;
  float tm=uTime*.20; float radius=mix(3.5,2.25,.5+.5*sin(uTime*.10));
  vec3 ro=vec3(sin(tm)*radius,.75+.24*sin(uTime*.13),cos(tm)*radius);
  vec3 ta=vec3(0.,-.08,0.); vec3 ww=normalize(ta-ro), uu=normalize(cross(ww,vec3(0,1,0))), vv=cross(uu,ww);
  vec3 rd=normalize(uv.x*uu+uv.y*vv+2.25*ww);
  vec3 col=sky(rd); float hit,t; vec3 obj=traceObject(ro,rd,hit,t); if(hit>0.) col=obj;
  float waterY=-.63; float tw=(waterY-ro.y)/rd.y;
  if(tw>0. && (hit<.5||tw<t)){
    vec3 wp=ro+rd*tw; float wa=sin(wp.x*4.+uTime*.8)*.025+sin(wp.z*7.-uTime)*.016;
    vec3 wn=normalize(vec3(-cos(wp.x*4.+uTime*.8)*.10,1.,-cos(wp.z*7.-uTime)*.11));
    vec3 rr=reflect(rd,wn); float rh,rt; vec3 refl=traceObject(wp+wn*.02,rr,rh,rt); if(rh<.5)refl=sky(rr);
    float f=.08+.92*pow(1.-max(dot(wn,-rd),0.),4.);
    vec3 water=mix(vec3(.004,.018,.03)+wa, refl, f); col=mix(water,sky(rd),1.-exp(-tw*.035));
  }
  float sun=max(dot(rd,normalize(vec3(-.72,.42,.53))),0.); col+=vec3(1.,.35,.12)*pow(sun,24.)*.12;
  col*=.93; col=col/(1.+col); col=pow(max(col,0.),vec3(.4545));
  col*=mix(vec3(.84,.95,1.08),vec3(1.09,.96,.84),smoothstep(.15,.8,dot(col,vec3(.299,.587,.114))));
  col*=.72+.28*smoothstep(1.35,.28,length(uv));
  float grain=hash21(gl_FragCoord.xy+uTime)-.5; col+=grain/255.*2.;
  float bar=max(0.,(1.-(uResolution.x/uResolution.y)/2.35)*.5); if(gl_FragCoord.y/uResolution.y<bar||gl_FragCoord.y/uResolution.y>1.-bar)col=vec3(0);
  fragColor=vec4(col,1.);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export function createMetamorphosisRenderer(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('此浏览器或显卡不支持 WebGL 2。');
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  gl.useProgram(program); const pos = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['uResolution','uTime','uMorph'].map(n => [n, gl.getUniformLocation(program,n)]));
  let quality=options.quality??.72, paused=false, autoMorph=true, manualMorph=0, raf=0, start=performance.now(), held=0, lastUi=0;
  function resize(){const dpr=Math.min(devicePixelRatio,1.5)*quality,w=Math.max(2,Math.floor(innerWidth*dpr)),h=Math.max(2,Math.floor(innerHeight*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}}
  function frame(now){resize(); if(!paused) held=(now-start)/1000; const p=(held%40)/40; const morph=autoMorph ? Math.max(0,Math.min(1,(p-.2)/.2))-Math.max(0,Math.min(1,(p-.75)/.2)) : manualMorph; gl.uniform2f(uniforms.uResolution,canvas.width,canvas.height);gl.uniform1f(uniforms.uTime,held);gl.uniform1f(uniforms.uMorph,morph);gl.drawArrays(gl.TRIANGLES,0,3);if(now-lastUi>100){options.onMorph?.(morph);lastUi=now;}raf=requestAnimationFrame(frame);}
  return {start(){raf=requestAnimationFrame(frame)},destroy(){cancelAnimationFrame(raf);gl.deleteProgram(program);gl.deleteBuffer(buffer)},setPaused(v){if(paused&&!v)start=performance.now()-held*1000;paused=v},setAutoMorph(v){autoMorph=v},setMorph(v){if(!autoMorph)manualMorph=v},setQuality(v){quality=v;canvas.width=0}};
}
