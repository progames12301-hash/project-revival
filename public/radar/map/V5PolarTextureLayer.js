import {calibrateRadarProfile,resolveRadarProfile} from './RadarProfiles.js?v=20260914-v5-clean25';

const EARTH_RADIUS_KM=6371.0088;

export function destinationPoint(radarLat,radarLon,distanceMeters,bearingDegrees){
  const distance=distanceMeters/1000/EARTH_RADIUS_KM;
  const bearing=bearingDegrees*Math.PI/180;
  const lat1=radarLat*Math.PI/180,lon1=radarLon*Math.PI/180;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(distance)+Math.cos(lat1)*Math.sin(distance)*Math.cos(bearing));
  const lon2=lon1+Math.atan2(Math.sin(bearing)*Math.sin(distance)*Math.cos(lat1),Math.cos(distance)-Math.sin(lat1)*Math.sin(lat2));
  return [((lon2*180/Math.PI+540)%360)-180,lat2*180/Math.PI];
}

function compileShader(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`V5 polar texture shader: ${error}`)}
  return shader;
}

function createPolarProgram(gl){
  const vertex=compileShader(gl,gl.VERTEX_SHADER,`#version 300 es
    uniform mat4 u_matrix;
    in vec2 a_pos;
    out vec2 v_uv;
    void main(){
      v_uv=a_pos;
      gl_Position=u_matrix*vec4(a_pos,0.0,1.0);
    }`);
  const fragment=compileShader(gl,gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec2 u_radar_uv;
    uniform float u_max_range_km;
    uniform float u_azimuth_count;
    uniform float u_gate_count;
    uniform float u_first_gate_km;
    uniform float u_gate_spacing_km;
    uniform float u_beam_width;
    uniform float u_visual_beam_multiplier;
    uniform float u_visual_azimuth_count;
    uniform float u_center_stretch;
    uniform int u_product_type;
    uniform vec4 u_palette[16];
    in vec2 v_uv;
    out vec4 fragColor;

    float mercatorY(float lat){
      float sin=sin(clamp(lat,-85.0511,85.0511)*3.14159265359/180.0);
      return 0.5-log((1.0+sin)/(1.0-sin))/(4.0*3.14159265359);
    }

    float latFromMercatorY(float y){
      float exp=exp(-4.0*3.14159265359*(y-0.5));
      return atan(exp)*180.0/3.14159265359;
    }

    float haversineKm(vec2 a, vec2 b){
      float lat1=a.y*3.14159265359/180.0;
      float lat2=b.y*3.14159265359/180.0;
      float dLat=lat2-lat1;
      float dLon=(b.x-a.x)*3.14159265359/180.0;
      float h=sin(dLat/2.0)*sin(dLat/2.0)+cos(lat1)*cos(lat2)*sin(dLon/2.0)*sin(dLon/2.0);
      return 2.0*6371.0088*asin(min(1.0,sqrt(h)));
    }

    float bearingTo(vec2 origin, vec2 point){
      float lat1=origin.y*3.14159265359/180.0;
      float lat2=point.y*3.14159265359/180.0;
      float delta=(point.x-origin.x)*3.14159265359/180.0;
      return (atan(sin(delta)*cos(lat2),cos(lat1)*sin(lat2)-sin(lat1)*cos(lat2)*cos(delta))*180.0/3.14159265359+360.0);
    }

    float angularDifference(float next, float current){
      return mod(next-current+540.0,360.0)-180.0;
    }

    vec2 cartesianToPolarUV(vec2 point, vec2 radar, float maxRangeKm){
      float azimuth=bearingTo(radar,point);
      float range=haversineKm(radar,point);
      float u=azimuth/360.0;
      float v=range/maxRangeKm;
      return vec2(u,v);
    }

    float classifyDBZ(vec4 color){
      float red=color.r*255.0;
      float green=color.g*255.0;
      float blue=color.b*255.0;
      float alpha=color.a*255.0;
      if(alpha<12.0)return -1.0;
      float max=max(red,max(green,blue));
      float min=min(red,min(green,blue));
      if(max<8.0)return -1.0;
      if(blue>green*1.08&&blue>red*1.15)return green<55.0?0.0:1.0;
      if(blue>100.0&&green>100.0&&red<100.0)return green>190.0?2.0:1.0;
      if(green>red*1.18&&green>blue*1.08){
        if(green>=220.0)return 2.0;
        if(green>=180.0)return 3.0;
        if(green>=140.0)return 4.0;
        if(green>=100.0)return 5.0;
        return 6.0;
      }
      if(green>=red*.9&&blue<100.0){
        if(red<120.0)return 6.0;
        if(red<220.0)return 7.0;
        return green>=235.0?8.0:9.0;
      }
      if(red>green*1.2&&red>blue*1.2){
        if(blue>120.0)return 13.0;
        if(green>=150.0)return 9.0;
        if(green>=80.0)return 10.0;
        if(red>=220.0)return 11.0;
        return 12.0;
      }
      if(red>185.0&&blue>130.0&&green<170.0)return 13.0;
      if(max-min<18.0)return max>225.0?12.0:-1.0;
      return 6.0;
    }

    float classifyVelocity(vec4 color){
      float red=color.r*255.0;
      float green=color.g*255.0;
      float blue=color.b*255.0;
      float alpha=color.a*255.0;
      if(alpha<12.0)return -1.0;
      float max=max(red,max(green,blue));
      float min=min(red,min(green,blue));
      float spread=max-min;
      if(spread<18.0)return 7.0;
      return green>red?3.0:11.0;
    }

    void main(){
      vec2 radar_lnglat=vec2(u_radar_uv.x*360.0-180.0,u_radar_uv.y*180.0-90.0);
      vec2 point_lnglat=vec2(v_uv.x*360.0-180.0,v_uv.y*180.0-90.0);
      float azimuth=bearingTo(radar_lnglat,point_lnglat);
      float range=haversineKm(radar_lnglat,point_lnglat);
      if(range>u_max_range_km)discard;
      float visualAzimuthStep=360.0/u_visual_azimuth_count;
      float quantizedAzimuth=floor(azimuth/visualAzimuthStep)*visualAzimuthStep+visualAzimuthStep*0.5;
      float u=quantizedAzimuth/360.0;
      float v=(range-u_first_gate_km)/(u_max_range_km-u_first_gate_km);
      // Center stretch: expand near-radar region
      float stretch=u_center_stretch;
      if(stretch>1.0){
        float t=v;
        v=pow(t,1.0/stretch);
      }
      if(v<0.0||v>1.0)discard;
      vec4 color=texture(u_texture,vec2(u,v));
      float code;
      if(u_product_type==1){
        code=classifyVelocity(color);
      }else{
        code=classifyDBZ(color);
      }
      if(code<0.0)discard;
      int idx=int(code);
      if(idx>=16)discard;
      fragColor=u_palette[idx];
    }`);
  const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error(`V5 polar texture program: ${error}`)}
  return program;
}

function mercatorY(latitude){
  const sin=Math.sin(Math.max(-85.0511,Math.min(85.0511,latitude))*Math.PI/180);
  return .5-Math.log((1+sin)/(1-sin))/(4*Math.PI);
}

function rgba(color,opacity){
  return [(color?.[0]??255)/255,(color?.[1]??255)/255,(color?.[2]??255)/255,opacity];
}

function layerRangeKm(sourceLayer,origin){
  const explicit=Number(sourceLayer.radar?.rangeKm);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const c=sourceLayer.coordinates;
  if(!Array.isArray(c)||c.length<4)return 250;
  const west=Number(c[0][0]),east=Number(c[1][0]),north=Number(c[0][1]),south=Number(c[2][1]);
  const candidates=[
    haversineKm(origin,[west,origin[1]]),
    haversineKm(origin,[east,origin[1]]),
    haversineKm(origin,[origin[0],north]),
    haversineKm(origin,[origin[0],south])
  ].filter(value=>Number.isFinite(value)&&value>0);
  return candidates.length?Math.min(...candidates):250;
}

function haversineKm(a,b){
  const lat1=a[1]*Math.PI/180,lat2=b[1]*Math.PI/180,dLat=lat2-lat1,dLon=(b[0]-a[0])*Math.PI/180;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*EARTH_RADIUS_KM*Math.asin(Math.min(1,Math.sqrt(h)));
}

async function decodeImage(url,signal){
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`V5 radar HTTP ${response.status}`);
  const blob=await response.blob();
  const bitmap=await createImageBitmap(blob);
  const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(bitmap.width,bitmap.height):Object.assign(document.createElement('canvas'),{width:bitmap.width,height:bitmap.height});
  const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true});context.imageSmoothingEnabled=false;context.clearRect(0,0,bitmap.width,bitmap.height);context.drawImage(bitmap,0,0);bitmap.close?.();
  return {width:canvas.width,height:canvas.height,texture:canvas};
}

export function createV5PolarTextureLayer({id,sourceLayer,palette,classify,dbzByCode=[],opacity=1}){
  let resolveReady;const readyPromise=new Promise(resolve=>{resolveReady=resolve});
  const isVelocity=sourceLayer.radar?.product==='velocity'||classify?.name==='velocity';
  const custom={
    id,type:'custom',renderingMode:'2d',ready:false,failed:false,opacity,palette,
    onAdd(map,gl){
      this.map=map;this.gl=gl;this.abortController=new AbortController();
      try{
        this.program=createPolarProgram(gl);
        this.aPos=gl.getAttribLocation(this.program,'a_pos');
        this.uMatrix=gl.getUniformLocation(this.program,'u_matrix');
        this.uTexture=gl.getUniformLocation(this.program,'u_texture');
        this.uRadarUV=gl.getUniformLocation(this.program,'u_radar_uv');
        this.uMaxRange=gl.getUniformLocation(this.program,'u_max_range_km');
        this.uAzimuthCount=gl.getUniformLocation(this.program,'u_azimuth_count');
        this.uGateCount=gl.getUniformLocation(this.program,'u_gate_count');
        this.uFirstGate=gl.getUniformLocation(this.program,'u_first_gate_km');
        this.uGateSpacing=gl.getUniformLocation(this.program,'u_gate_spacing_km');
        this.uBeamWidth=gl.getUniformLocation(this.program,'u_beam_width');
        this.uVisualBeamMultiplier=gl.getUniformLocation(this.program,'u_visual_beam_multiplier');
        this.uVisualAzimuthCount=gl.getUniformLocation(this.program,'u_visual_azimuth_count');
        this.uCenterStretch=gl.getUniformLocation(this.program,'u_center_stretch');
        this.uProductType=gl.getUniformLocation(this.program,'u_product_type');
        this.uPalette=gl.getUniformLocation(this.program,'u_palette');
      }catch(error){this.failed=true;resolveReady(false);console.error(error);return}
      void this.prepare().catch(error=>{if(error?.name!=='AbortError')console.error('BrasilScope V5 Polar Texture:',error);this.failed=true;resolveReady(false)});
    },
    async prepare(){
      const profile=resolveRadarProfile(sourceLayer);
      const radarLat=Number(profile.latitude??sourceLayer.radar?.latitude),radarLon=Number(profile.longitude??sourceLayer.radar?.longitude);
      if(!Number.isFinite(radarLat)||!Number.isFinite(radarLon)||!Array.isArray(sourceLayer.coordinates))throw new Error('Radar sem origem geográfica exata.');
      const maxRangeKm=layerRangeKm(sourceLayer,[radarLon,radarLat]);
      const calibrated=calibrateRadarProfile(profile,{width:1,height:1},maxRangeKm*1000,sourceLayer);
      const gateSpacingKm=Number(calibrated.gateSpacingMeters)/1000||maxRangeKm/128;
      const firstGateKm=Number(calibrated.firstGateMeters)/1000||maxRangeKm*0.055;
      const azimuthCount=Number(calibrated.azimuthCount)||720;
      const gateCount=Number(calibrated.maxGates)||128;
      const beamWidth=Number(calibrated.beamWidthDeg)||360/azimuthCount;
      const visualBeamMultiplier=2.5;
      const visualAzimuthCount=Math.round(azimuthCount/visualBeamMultiplier);
      const imageData=await decodeImage(sourceLayer.url,this.abortController.signal);
      this.texture=imageData.texture;
      this.textureWidth=imageData.width;
      this.textureHeight=imageData.height;
      this.maxRangeKm=maxRangeKm;
      this.azimuthCount=azimuthCount;
      this.gateCount=gateCount;
      this.firstGateKm=firstGateKm;
      this.gateSpacingKm=gateSpacingKm;
      this.beamWidth=beamWidth;
      this.visualBeamMultiplier=visualBeamMultiplier;
      this.visualAzimuthCount=visualAzimuthCount;
      this.centerStretch=3.0;
      this.radarLat=radarLat;
      this.radarLon=radarLon;
      this.radarUVX=(radarLon+180)/360;
      this.radarUVY=(radarLat+90)/180;
      this.productType=isVelocity?1:0;
      this.paletteUniform=new Float32Array(16*4);
      for(let i=0;i<16;i++){
        const color=this.palette?.[i]||[0,0,0,0];
        this.paletteUniform[i*4]=color[0]/255;
        this.paletteUniform[i*4+1]=color[1]/255;
        this.paletteUniform[i*4+2]=color[2]/255;
        this.paletteUniform[i*4+3]=color[3]!==undefined?color[3]:1;
      }
      const vertices=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
      this.buffer=this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.buffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER,vertices,this.gl.STATIC_DRAW);
      this.ready=true;resolveReady(true);this.map.triggerRepaint();
    },
    setOpacity(value){this.opacity=value;this.map?.triggerRepaint()},
    setPalette(value){this.palette=value;this.prepare();this.map?.triggerRepaint()},
    render(gl,args){
      if(!this.ready||!this.program||!this.texture)return;
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.uMatrix,false,args.defaultProjectionData.mainMatrix);
      gl.uniform1f(this.uMaxRange,this.maxRangeKm);
      gl.uniform1f(this.uAzimuthCount,this.azimuthCount);
      gl.uniform1f(this.uGateCount,this.gateCount);
      gl.uniform1f(this.uFirstGate,this.firstGateKm);
      gl.uniform1f(this.uGateSpacing,this.gateSpacingKm);
      gl.uniform1f(this.uBeamWidth,this.beamWidth);
      gl.uniform1f(this.uVisualBeamMultiplier,this.visualBeamMultiplier);
      gl.uniform1f(this.uVisualAzimuthCount,this.visualAzimuthCount);
      gl.uniform1f(this.uCenterStretch,this.centerStretch);
      gl.uniform1i(this.uProductType,this.productType);
      gl.uniform2f(this.uRadarUV,this.radarUVX,this.radarUVY);
      gl.uniform4fv(this.uPalette,this.paletteUniform);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,this.glTexture);
      if(!this.glTexture){
        this.glTexture=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,this.glTexture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.texture);
      }
      gl.uniform1i(this.uTexture,0);
      gl.enableVertexAttribArray(this.aPos);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.vertexAttribPointer(this.aPos,2,gl.FLOAT,false,0,0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    },
    onRemove(map,gl){this.abortController?.abort();if(this.buffer)gl.deleteBuffer(this.buffer);if(this.glTexture)gl.deleteTexture(this.glTexture);if(this.program)gl.deleteProgram(this.program);this.ready=false}
  };
  return custom;
}