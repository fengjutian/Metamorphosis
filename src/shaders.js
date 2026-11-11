export const fullscreenVertex = `#version 300 es
in vec2 position;
out vec2 vUv;
void main(){vUv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;

export const volumeFragment = `#version 300 es
precision highp float;
precision highp sampler2D;
out vec4 fragColor;
uniform sampler2D uPrevious;
uniform sampler2D uTarget;
uniform float uMorph;
uniform float uSize;
uniform vec2 uGrid;
uniform int uMode;

#define TAU 6.28318530718

float hash11(float n){return fract(sin(n*12.9898)*43758.5453);}
float hash31(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1)),f.x),f.y),f.z);
}
float turbulence(vec3 p){float s=0.,a=.5;for(int i=0;i<6;i++){s+=abs(noise3(p)*2.-1.)*a;p=p*2.03+1.7;a*=.5;}return s;}
float ellipsoid(vec3 p,vec3 r){float k0=length(p/r),k1=length(p/(r*r));return k0*(k0-1.)/max(k1,1e-4);}
float petalRing(vec3 q,float count,float rotation,float baseRadius,float baseHeight,float tilt,float len,float width,float thick,float bend,float cup,float seed){
  float radius=length(q.xz),angle=atan(q.z,q.x)-rotation,sector=TAU/count,index=round(angle/sector),local=angle-index*sector,d=1e9;
  for(int j=-1;j<=1;j++){
    float a=local+float(j)*sector,id=mod(index-float(j),count),h=hash11(id+seed*31.),pt=tilt+.12*(h-.5),ll=len*(.9+.2*h);
    vec3 p=vec3(radius*cos(a)-baseRadius,q.y-baseHeight,radius*sin(a));
    float c=cos(pt),s=sin(pt),u=p.x*c+p.y*s,v=-p.x*s+p.y*c;
    v-=bend*u*u+cup*p.z*p.z;
    d=min(d,ellipsoid(vec3(u-.5*ll,v,p.z),vec3(.5*ll,thick,width)));
  }
  return d;
}
float lotus(vec3 q){
  float b=-.5,d=1e9;
  d=min(d,petalRing(q,9.,0.,.10,b,.45,.85,.17,.075,.25,2.,1.));
  d=min(d,petalRing(q,9.,.349,.10,b+.02,.75,.85,.16,.075,.30,2.5,2.));
  d=min(d,petalRing(q,8.,0.,.11,b+.04,1.,.80,.15,.07,.30,2.5,3.));
  d=min(d,petalRing(q,7.,.449,.12,b+.06,1.2,.65,.13,.07,.30,3.,4.));
  d=min(d,petalRing(q,6.,0.,.14,b+.08,1.38,.48,.10,.065,.20,3.,5.));
  vec3 p=q-vec3(0,b+.28,0);vec2 w=vec2(length(p.xz)-.1,abs(p.y)-.03);
  d=min(d,min(max(w.x,w.y),0.)+length(max(w,0.))-.03);
  return min(d,length(q-vec3(0,b+.04,0))-.12);
}
ivec3 voxelFromPixel(ivec2 p){int n=int(uSize),gx=int(uGrid.x),tx=p.x/n,ty=p.y/n;return ivec3(p.x-tx*n,p.y-ty*n,tx+ty*gx);}
ivec2 pixelFromVoxel(ivec3 v){int n=int(uSize),gx=int(uGrid.x);return ivec2((v.z%gx)*n+v.x,(v.z/gx)*n+v.y);}
float previous(ivec3 v){int n=int(uSize);v=clamp(v,ivec3(0),ivec3(n-1));return texelFetch(uPrevious,pixelFromVoxel(v),0).r;}
float targetField(vec3 voxel){
  vec3 q=voxel/(uSize*.5)-1.;
  float n=turbulence(q*2.)*.55-.31;
  float sphere=length(q)-.6+n*.72;
  float flower=lotus(q)+n*.15;
  return mix(sphere,flower,uMorph);
}
void main(){
  ivec3 V=voxelFromPixel(ivec2(gl_FragCoord.xy));
  if(V.z>=int(uSize)){fragColor=vec4(4,0,0,1);return;}
  if(uMode==0){fragColor=vec4(targetField(vec3(V)),0,0,1);return;}
  float field=texelFetch(uTarget,ivec2(gl_FragCoord.xy),0).r;
  if(field<=.1){fragColor=vec4(field,0,0,1);return;}
  float best=1e9,bestLen=0.,voxel=2./uSize;
  for(int k=0;k<27;k++){
    if(k==13)continue;
    ivec3 off=ivec3(k%3,(k/3)%3,k/9)-1;
    float value=previous(V+off);
    if(value<best){best=value;bestLen=length(vec3(off));}
  }
  fragColor=vec4(min(field,best+bestLen*voxel),0,0,1);
}`;

export const sceneFragment = `#version 300 es
precision highp float;
precision highp sampler2D;
out vec4 fragColor;
uniform sampler2D uVolume;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMorph;
uniform float uSize;
uniform vec2 uGrid;

const float WATER=-.62,SKY_DEPTH=120.;
const vec3 SUN=vec3(-.738,.422,.527);
const int KEY_COUNT=8;
const vec4 KEYS[KEY_COUNT]=vec4[KEY_COUNT](vec4(4.5,1.2,0,2.4),vec4(3.,.6,0,2.6),vec4(1.9,-.3,.1,1.9),vec4(1.5,-.35,.2,1.7),vec4(1.6,.5,.3,2.),vec4(1.5,1.6,0,1.6),vec4(2.5,1.,0,2.4),vec4(3.8,.3,0,3.));

vec2 atlasUV(vec3 v,float z){float n=uSize;return (vec2(mod(z,uGrid.x)*n+v.x,floor(z/uGrid.x)*n+v.y)+.5)/(n*uGrid);}
float volumeSample(vec3 p){
  vec3 v=clamp((p*.5+.5)*(uSize-1.),0.,uSize-1.);
  float z0=floor(v.z),z1=min(z0+1.,uSize-1.);
  return mix(texture(uVolume,atlasUV(v,z0)).r,texture(uVolume,atlasUV(v,z1)).r,fract(v.z));
}
vec4 key(int i){return KEYS[((i%KEY_COUNT)+KEY_COUNT)%KEY_COUNT];}
vec4 cameraPath(float u){int i=int(floor(u));float f=fract(u);vec4 p0=key(i-1),p1=key(i),p2=key(i+1),p3=key(i+2);return .5*(2.*p1+(-p0+p2)*f+(2.*p0-5.*p1+4.*p2-p3)*f*f+(-p0+3.*p1-3.*p2+p3)*f*f*f);}
vec2 boxHit(vec3 p,vec3 d){vec3 a=(-1.-p)/d,b=(1.-p)/d,m=min(a,b),M=max(a,b);return vec2(max(max(m.x,m.y),m.z),min(min(M.x,M.y),M.z));}
vec3 sky(vec3 d){float y=max(d.y,0.);vec3 c=mix(vec3(1,.62,.42),vec3(.08,.18,.42),pow(y,.45));float s=max(dot(d,SUN),0.);return c+vec3(1,.6,.3)*(pow(s,8.)*.35+pow(s,400.)*6.);}
vec3 normalAt(vec3 p){float h=.03;return normalize(vec3(volumeSample(p+vec3(h,0,0))-volumeSample(p-vec3(h,0,0)),volumeSample(p+vec3(0,h,0))-volumeSample(p-vec3(0,h,0)),volumeSample(p+vec3(0,0,h))-volumeSample(p-vec3(0,0,h))));}
vec3 albedo(vec3 p){
  vec3 sphere=mix(vec3(.55,.08,.04),vec3(1,.55,.2),smoothstep(-.7,.5,p.y));
  float rad=length(p.xz),tip=clamp(rad*.8+(p.y+.5)*.45,0.,1.);
  vec3 petal=mix(vec3(1,.9,.86),vec3(.95,.28,.5),smoothstep(.15,.85,tip));
  float pod=smoothstep(.18,.12,rad)*smoothstep(-.34,-.28,p.y)*smoothstep(-.12,-.20,p.y);
  return mix(sphere,mix(petal,vec3(.85,.7,.15),pod),uMorph);
}
vec3 shade(vec3 p,vec3 n,vec3 d,float field){
  vec3 alb=albedo(p);float nl=dot(n,SUN),dif=max(nl,0.),wrap=.5+.5*nl;wrap*=wrap;
  float ao=mix(.35,1.,clamp(volumeSample(p+n*.06)/.06,0.,1.));
  vec3 h=normalize(SUN-d);float spec=pow(max(dot(n,h),0.),60.),fres=pow(1.-max(dot(n,-d),0.),3.);
  vec3 ambient=mix(vec3(.04,.09,.1),vec3(.25,.3,.45),.5+.5*n.y);
  float transmission=pow(max(dot(d,SUN),0.),3.)*exp(field*15.);
  vec3 transmissionColor=mix(vec3(1,.6,.3),vec3(1,.65,.7),uMorph);
  return alb*(vec3(1,.85,.7)*(dif*1.2+wrap*.3)+ambient)*ao+spec*vec3(1,.8,.6)*.5*ao+fres*sky(reflect(d,n))*.35*ao+alb*transmissionColor*transmission*.8;
}
vec4 marchVolume(vec3 p,vec3 d,float nearT,float farT,out float depth,int limit){
  vec3 color=vec3(0);float T=1.,stepLength=1.,t=nearT,dl=1./uSize;depth=1e9;p+=t*d;
  for(int i=0;i<32;i++){if(t>=farT||stepLength<=.01)break;stepLength=max(volumeSample(p),.002);p+=stepLength*d;t+=stepLength;}
  for(int i=0;i<640;i++){
    if(i>=limit||t>=farT||T<=.01)break;
    float field=volumeSample(p),density=smoothstep(0.,-1./uSize,field);
    if(density>0.){color+=shade(p,normalAt(p),d,field)*T*density*dl*9.;T*=exp(-9.*density*dl);if(depth>1e8&&T<.5)depth=t;}
    p+=dl*d;t+=dl;
  }
  return vec4(color,T);
}
vec2 waterSlope(vec2 q,float t,float dist){
  vec2 swell=vec2(0),ripple=vec2(0);
  for(int i=0;i<3;i++){float f=float(i);vec2 dr=vec2(cos(f*2.4+.3),sin(f*2.4+.3));swell+=dr*cos(dot(q,dr)*1.4*pow(1.6,f)+t*(.5+.2*f))*.035/(1.+.6*f);dr=vec2(cos(f*2.1+1.2),sin(f*2.1+1.2));ripple+=dr*cos(dot(q,dr)*9.*pow(1.5,f)+t*(1.6+.5*f))*.018/(1.+f);}
  float r=length(q),env=smoothstep(.5,.9,r)*exp(-max(r-.8,0.)*.9),rings=(cos(r*16.-t*2.2)*.06+cos(r*27.-t*3.1)*.025)*env;
  return swell/(1.+.05*dist)+ripple/(1.+.25*dist)+q/max(r,.001)*rings/(1.+.15*dist);
}
void main(){
  vec2 uv=(2.*gl_FragCoord.xy-uResolution)/uResolution.y;vec4 k=cameraPath(uTime/5.);float theta=.22*uTime+.35*sin(.17*uTime),height=max(k.y,WATER+.2);
  vec3 P=vec3(k.x*sin(theta),height,k.x*cos(theta)),target=vec3(0,k.z-.1,0);P+=.02*vec3(sin(uTime*1.3),sin(uTime*1.7+1.),sin(uTime*1.1+2.));
  vec3 forward=normalize(target-P),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward),D=normalize(uv.x*right+uv.y*up+k.w*forward);
  if(gl_FragCoord.x<1.&&gl_FragCoord.y<1.){vec3 s=vec3(dot(SUN,right),dot(SUN,up),dot(SUN,forward));vec2 sunUV=.5+.5*(s.xy*k.w/max(s.z,.001))*vec2(uResolution.y/uResolution.x,1);fragColor=vec4(sunUV,smoothstep(0.,.3,s.z)*.99,SKY_DEPTH);return;}
  vec2 bounds=boxHit(P,D);float waterT=D.y<-.001?(WATER-P.y)/D.y:1e9,objectDepth=1e9;vec4 volume=vec4(0,0,0,1);
  if(bounds.x<bounds.y&&bounds.y>0.)volume=marchVolume(P,D,max(bounds.x,0.),min(bounds.y,waterT),objectDepth,384);
  vec3 background;float depth=SKY_DEPTH;
  if(waterT<1e8){
    vec3 hit=P+waterT*D;depth=min(waterT*10.,80.);vec2 slope=waterSlope(hit.xz,uTime,waterT);vec3 nw=normalize(vec3(-slope.x,1,-slope.y)),reflected=reflect(D,nw);reflected.y=abs(reflected.y);
    vec2 rb=boxHit(hit,reflected);float unused;vec4 reflectedVolume=vec4(0,0,0,1);if(rb.x<rb.y&&rb.y>0.)reflectedVolume=marchVolume(hit,reflected,max(rb.x,0.),rb.y,unused,120);
    vec3 reflection=reflectedVolume.rgb+reflectedVolume.a*sky(reflected);float fres=.1+.9*pow(1.-max(dot(nw,-D),0.),4.);vec3 deep=vec3(.004,.022,.035)+vec3(0,.02,.02)*(.5+.5*nw.x);
    background=mix(sky(normalize(vec3(D.x,0,D.z))),mix(deep,reflection,fres),exp(-.03*waterT));
  }else background=sky(D);
  if(objectDepth<1e8)depth=objectDepth*10.;
  fragColor=vec4(volume.rgb+volume.a*background,depth);
}`;

export const postFragment = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uTime;
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float coc(float d){float c=smoothstep(20.,70.,abs(d-25.))*.6;c*=1.-smoothstep(85.,105.,d);return max(c,smoothstep(12.,0.,d));}
vec3 karis(vec2 uv,vec2 ts){vec3 c=texture(uScene,uv).rgb,a=texture(uScene,uv+vec2(-.75,-.75)*ts).rgb,b=texture(uScene,uv+vec2(.75,-.75)*ts).rgb,d=texture(uScene,uv+vec2(-.75,.75)*ts).rgb,e=texture(uScene,uv+vec2(.75,.75)*ts).rgb;float wc=2./(1.+luma(c)),wa=1./(1.+luma(a)),wb=1./(1.+luma(b)),wd=1./(1.+luma(d)),we=1./(1.+luma(e));return(c*wc+a*wa+b*wb+d*wd+e*we)/(wc+wa+wb+wd+we);}
void main(){
  vec2 ts=1./uResolution,uv=gl_FragCoord.xy*ts,v=uv-.5;float aspect=uResolution.x/uResolution.y,bar=max(0.,(1.-aspect/2.35)/2.);
  if(uv.y<bar||uv.y>1.-bar){fragColor=vec4(0,0,0,1);return;}
  vec2 ca=v*.003*dot(v,v);vec3 sharp=vec3(karis(clamp(uv-ca,0.,1.),ts).r,karis(uv,ts).g,karis(clamp(uv+ca,0.,1.),ts).b);vec4 center=texture(uScene,uv);float blur=coc(center.a),rnd=hash12(gl_FragCoord.xy+uTime);vec3 color=sharp;
  if(blur>.01){vec3 acc=vec3(0);float weights=0.;for(int i=0;i<16;i++){float r=sqrt((float(i)+.5)/16.),a=float(i)*2.39996323+rnd*6.28318;vec2 off=vec2(cos(a)/aspect,sin(a))*r*blur*.0055;vec4 s=texture(uScene,clamp(uv+off,0.,1.));float w=s.a<center.a?clamp(coc(s.a)/max(blur,.001),0.,1.):1.;w/=1.+luma(s.rgb);acc+=s.rgb*w;weights+=w;}color=mix(sharp,acc/max(weights,.001),smoothstep(.01,.1,blur));}
  vec3 bloom=vec3(0);for(int i=0;i<24;i++){float r=sqrt((float(i)+.5)/24.)*.02,a=float(i)*2.39996323+rnd*6.28318;vec2 off=vec2(cos(a)/aspect,sin(a))*r;vec4 s=texture(uScene,clamp(uv+off,0.,1.));float far=smoothstep(30.,60.,s.a)*(1.-smoothstep(105.,115.,s.a)),L=luma(s.rgb);bloom+=s.rgb*max(L-.25,0.)*far/(1.+L);}color+=bloom/24.*1.5*vec3(1,.72,.45);
  vec4 sun=texelFetch(uScene,ivec2(0),0);if(sun.z>0.){vec2 delta=(sun.xy-uv)*.95/48.,pos=uv+delta*rnd;float illumination=1.,sum=0.;for(int i=0;i<48;i++){vec2 dv=(pos-sun.xy)*vec2(aspect,1);float d2=dot(dv,dv),glow=exp(-d2/.012)+.15*exp(-sqrt(d2)*3.),open=1.;if(all(greaterThanEqual(pos,vec2(0)))&&all(lessThanEqual(pos,vec2(1))))open=smoothstep(90.,110.,texture(uScene,pos).a);sum+=glow*open*illumination;illumination*=.965;pos+=delta;}color+=vec3(1,.7,.42)*pow(sum/48.,.8)*1.1*sun.z;}
  color+=vec3(.1,.18,.3)*.3*smoothstep(30.,52.,center.a)*(1.-smoothstep(90.,110.,center.a));color*=.9;color=color/(1.+color);color=pow(max(color,0.),vec3(1./2.2));float lum=luma(color);color*=mix(vec3(.85,.97,1.1),vec3(1.1,1,.88),smoothstep(.1,.8,lum));color=mix(vec3(lum),color,1.15);color=mix(color,smoothstep(0.,1.,color),.5);color*=mix(.72,1.,smoothstep(1.4,.35,length(v)));color+=(rnd-.5)*1.5/255.;
  float local=mod(uTime,40.),fade=(uTime<1.5?1.:smoothstep(0.,1.5,local))*smoothstep(0.,1.5,40.-local);fragColor=vec4(clamp(color*fade,0.,1.),1);
}`;
