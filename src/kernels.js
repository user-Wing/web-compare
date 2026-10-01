export const KERNELS = [
  'Nearest', 'Bilinear', 'Bicubic (Catmull-Rom)', 'Lanczos 3', 'Jinc 2', 'Spline36',
  'Super-XBR（单阶段）', 'Softcubic (B-spline)', 'Mitchell-Netravali', 'Bilateral', '亮度引导双边重建',
];

// The same reconstruction equations as the local 3FP implementation.
// Super-XBR pass-0 derives from Hyllian's MIT shader; not the complete 3-pass scaler.
export const kernelShader = `
vec3 fetchValue(ivec2 p, int plane);
ivec2 dimensions(int plane);
float spline(float x) {
  x=abs(x);
  if(x<1.) return ((13./11.*x-453./209.)*x-3./209.)*x+1.;
  if(x<2.) {x-=1.;return ((-6./11.*x+270./209.)*x-156./209.)*x;}
  if(x<3.) {x-=2.;return ((1./11.*x-45./209.)*x+26./209.)*x;}
  return 0.;
}
float cubic(float x,float B,float C) {
  x=abs(x);
  if(x<1.) return ((12.-9.*B-6.*C)*x*x*x+(-18.+12.*B+6.*C)*x*x+6.-2.*B)/6.;
  if(x<2.) return ((-B-6.*C)*x*x*x+(6.*B+30.*C)*x*x+(-12.*B-48.*C)*x+8.*B+24.*C)/6.;
  return 0.;
}
float sinc(float x) {x=abs(x);return x<.00001?1.:sin(3.14159265359*x)/(3.14159265359*x);}
float bessel(float x) {
  x=abs(x);float y=x*x;
  float p=x*(72362614232.+y*(-7895059235.+y*(242396853.1+y*(-2972611.439+y*(15704.4826+y*(-30.16036606))))));
  float q=144725228442.+y*(2300535178.+y*(18583304.74+y*(99447.43394+y*(376.9991397+y))));
  return p/q;
}
float jinc(float x) {x=abs(x);if(x<.00001)return 1.;float a=3.14159265359*x;return 2.*bessel(a)/a;}
float weight(float d,int algorithm) {
  if(algorithm==3)return abs(d)<3.?sinc(d)*sinc(d/3.):0.;
  if(algorithm==5)return spline(d);
  return cubic(d,algorithm==7?1.:algorithm==8?1./3.:0.,algorithm==7?0.:algorithm==8?1./3.:.5);
}
float luminance(vec3 c) {return dot(c,vec3(.2126,.7152,.0722));}
vec3 linearSample(vec2 p,int plane) {
  ivec2 o=ivec2(floor(p));vec2 f=fract(p);
  return mix(mix(fetchValue(o,plane),fetchValue(o+ivec2(1,0),plane),f.x),mix(fetchValue(o+ivec2(0,1),plane),fetchValue(o+ivec2(1),plane),f.x),f.y);
}
float edgeDistance(float c0,float c1,float c2,float d1,float d2,float e1,float e2,float e3) {
  return abs(c1-c2)+abs(c1-c0)+abs(e2-e1)+abs(e2-e3)+2.*abs(d1-d2)-abs(c0-c2)-abs(e1-e3);
}
vec3 superXbr(vec2 uv,int plane) {
  vec2 p=uv*vec2(dimensions(plane));ivec2 o=ivec2(floor(p));
  if(any(lessThan(fract(p),vec2(.5))))return fetchValue(o,plane);
  vec3 P0=fetchValue(o+ivec2(-1,-1),plane),P1=fetchValue(o+ivec2(2,-1),plane),P2=fetchValue(o+ivec2(-1,2),plane),P3=fetchValue(o+ivec2(2,2),plane);
  vec3 B=fetchValue(o+ivec2(0,-1),plane),C=fetchValue(o+ivec2(1,-1),plane),D=fetchValue(o+ivec2(-1,0),plane),E=fetchValue(o,plane),F=fetchValue(o+ivec2(1,0),plane);
  vec3 G=fetchValue(o+ivec2(-1,1),plane),H=fetchValue(o+ivec2(0,1),plane),I=fetchValue(o+ivec2(1),plane),F4=fetchValue(o+ivec2(2,0),plane),I4=fetchValue(o+ivec2(2,1),plane),H5=fetchValue(o+ivec2(0,2),plane),I5=fetchValue(o+ivec2(1,2),plane);
  float edge=edgeDistance(luminance(G),luminance(E),luminance(C),luminance(H),luminance(F),luminance(H5),luminance(I),luminance(F4))-
    edgeDistance(luminance(B),luminance(F),luminance(I4),luminance(E),luminance(I),luminance(D),luminance(H),luminance(I5));
  float k=.129633;vec3 a=-k*(P2+P1)+(k+.5)*(H+F),b=-k*(P0+P3)+(k+.5)*(E+I);
  vec3 correction=mix((P2-H)*(F-P1),(P0-E)*(I-P3),step(0.,edge));
  vec3 low=min(min(E,F),min(H,I))+correction,high=max(max(E,F),max(H,I))-correction;
  return clamp(mix(a,b,smoothstep(-1.000001,1.000001,edge)),min(low,high),max(low,high));
}
vec3 reconstruct(vec2 uv,int plane,int algorithm,vec2 footprint,bool antiRinging) {
  vec2 dim=vec2(dimensions(plane)),p=uv*dim-.5;ivec2 o=ivec2(floor(p));
  if(algorithm==0)return fetchValue(ivec2(floor(uv*dim)),plane);
  if(algorithm==1)return linearSample(p,plane);
  if(algorithm==6)return superXbr(uv,plane);
  vec3 sum=vec3(0.),center=linearSample(p,plane);float norm=0.;
  vec2 filterScale=clamp(footprint,vec2(1.),vec2(4.));
  // Downscaling widens the kernel, bounded at 4x; larger reductions are documented.
  int radius=algorithm==3||algorithm==5?int(ceil(3.*max(filterScale.x,filterScale.y))):2;
  for(int y=1-radius;y<=radius;y++)for(int x=1-radius;x<=radius;x++) {
    vec2 d=vec2(o+ivec2(x,y))-p;vec3 v=fetchValue(o+ivec2(x,y),plane);float w;
    if(algorithm==4) {float r=length(d);w=r<2.?jinc(r)*jinc(r/2.):0.;}
    else if(algorithm>=9) {
      float range=length(v-center);
      if(algorithm==10) {
        vec2 q=(vec2(o+ivec2(x,y))+.5)/dim;
        range=plane==3?luminance(v-center):fetchValue(ivec2(q*vec2(dimensions(0))),0).r-fetchValue(ivec2(uv*vec2(dimensions(0))),0).r;
      }
      w=exp(-dot(d,d)*.5-range*range*200.);
    } else w=weight(d.x/filterScale.x,algorithm)*weight(d.y/filterScale.y,algorithm);
    sum+=v*w;norm+=w;
  }
  vec3 result=sum/max(abs(norm),.000001);
  if(antiRinging) {
    vec3 a=fetchValue(o,plane),b=fetchValue(o+ivec2(1,0),plane),c=fetchValue(o+ivec2(0,1),plane),d=fetchValue(o+ivec2(1),plane);
    result=mix(result,clamp(result,min(min(a,b),min(c,d)),max(max(a,b),max(c,d))),.5);
  }
  return result;
}
`;
