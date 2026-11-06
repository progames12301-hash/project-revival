export class RadarAnimation {
  constructor(onFrame){this.onFrame=onFrame;this.count=0;this.index=0;this.speed=0;this.playing=false;this.timer=null;this.raf=null;this.tickToken=0}
  setFrames(count,index=Math.max(0,count-1)){this.pause();this.count=count;this.index=Math.min(Math.max(0,index),Math.max(0,count-1));return this.onFrame(this.index)}
  setSpeed(speed){const value=Number(speed);this.speed=Number.isFinite(value)&&value>=0?value:1;if(this.playing){this.pause();this.play()}}
  async go(index){if(!this.count)return;this.index=(index+this.count)%this.count;await this.onFrame(this.index)}
  previous(){return this.go(this.index-1)} next(){return this.go(this.index+1)}
  play(){
    if(this.count<2||this.playing)return;
    this.playing=true;const token=++this.tickToken;
    const tick=async()=>{
      if(!this.playing||token!==this.tickToken)return;
      const started=performance.now();
      await this.next();
      if(!this.playing||token!==this.tickToken)return;
      if(this.speed===0){this.raf=requestAnimationFrame(tick);return}
      const targetInterval=Math.max(50,900/this.speed);
      const remaining=Math.max(0,targetInterval-(performance.now()-started));
      this.timer=setTimeout(tick,remaining);
    };
    if(this.speed===0)this.raf=requestAnimationFrame(tick);
    else this.timer=setTimeout(tick,Math.max(0,900/this.speed));
  }
  pause(){this.playing=false;this.tickToken++;clearTimeout(this.timer);this.timer=null;if(this.raf!==null)cancelAnimationFrame(this.raf);this.raf=null}
  toggle(){this.playing?this.pause():this.play();return this.playing}
  destroy(){this.pause()}
}
