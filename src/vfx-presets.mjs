const gradient=(a,b)=>({type:'linear',angle:90,stops:[{offset:0,color:a,opacity:1},{offset:1,color:b,opacity:1}]});
/** Colour over a particle's life: [offset, [r,g,b], opacity]. */
const life=(...stops)=>({type:'linear',angle:0,stops:stops.map(([offset,color,opacity=1])=>({offset,color,opacity}))});
const spectrum=(...colors)=>life(...colors.map((color,i)=>[i/(colors.length-1),color]));
const looks='Looks',impacts='Explosions & impacts',power='Energy & power',magic='Magic & cartoon',fire='Fire & smoke',stage='Weather & stage';
const EMBERS=life([0,[255,245,200]],[.3,[255,190,70]],[.7,[255,90,20]],[1,[140,20,10],0]);
const FLAME=life([0,[255,245,200]],[.25,[255,200,60]],[.6,[255,90,20]],[1,[140,20,10],0]);
const WHITE_HOT=(r,g,b)=>life([0,[255,255,255]],[.4,[r,g,b]],[1,[r*.6|0,g*.6|0,b*.6|0],0]);
// Particle option indices, in registry order.
const LOOK={glow:0,spark:1,dot:2,ring:3,shard:4,smoke:5,star:6,bokeh:7,flame:8,cloud:9,toonFlame:10,leaf:11,petal:12,flake:13,drop:14,heart:15,toonStar:16,pixel:17,bolt:18,wisp:19,rock:20,splat:21,burst:22};
const POP=3,CIRCLE=1,BODY=2,LINE=3,FOLLOW=1,SOLID=2,BURST=1;
const particles=params=>['particles',params],smoke=params=>['smoke',params],explosion=params=>['explosion',params],aura=params=>['aura',params],beam=params=>['beam',params];
// Reusable parts of combined effects.
const sparks=(color=WHITE_HOT(255,200,80),extra={})=>particles({emission:BURST,count:18,life:12,look:LOOK.spark,color,size:2.2,speed:11,spread:360,gravity:.3,drag:.05,endSize:.4,variation:.6,stretch:1.2,fade:.4,glow:.6,...extra});
const puff=(color=0xc4b6a4,extra={})=>smoke({style:4,emission:BURST,count:8,color,size:14,life:34,spread:8,...extra});
/** Presets install ordinary editable effects. Generated presets combine several
 * effects into one clip, sequenced with each effect's Start delay; they start at
 * the playhead for `duration` frames (null plays for the whole animation) and
 * may be limited to figure or stage targets. Single effects and their styles
 * live in Add effect. */
export const VFX_PRESETS={
 'Big explosion':{icon:'explosion',category:impacts,duration:72,effects:[
  explosion({size:1.2}),
  explosion({style:8,color:0x9c8b7b,size:1.5,flash:0,ring:0,sparks:0,delay:2}),
  smoke({style:1,emission:BURST,count:12,color:0x3e3a40,size:46,rise:1.1,life:110,spread:50,delay:8}),
  particles({emission:BURST,count:40,life:70,look:LOOK.glow,color:EMBERS,size:2.2,speed:3,spread:360,gravity:-.03,flow:30,twinkle:.6,endSize:.3,variation:.6,delay:4})]},
 'Cartoon blast':{icon:'explosion',category:impacts,duration:32,effects:[
  explosion({style:1,color:0xff9d2a}),
  particles({emission:BURST,count:8,life:22,look:LOOK.toonStar,color:0xffd83a,size:7,speed:6,spread:360,drag:.08,sizeMode:POP,spin:10,outline:1,outlineWidth:1.6,blend:SOLID,delay:2}),
  particles({emission:BURST,count:12,life:8,look:LOOK.spark,color:0xffffff,size:3,speed:20,spread:360,drag:.12,stretch:1.4,endSize:.3,variation:.3,fade:.3,blend:SOLID})]},
 'Ground slam':{icon:'shockwave',category:impacts,duration:40,effects:[
  explosion({style:8,color:0xb49a7c,size:1.2,debris:1.5,smoke:.4,flash:0}),
  particles({emission:BURST,count:16,life:34,look:LOOK.rock,color:0x6d625a,size:5,speed:9,direction:-90,spread:110,gravity:.45,spin:12,ground:1,variation:.6,fade:.1,blend:SOLID}),
  puff(0xb8a894,{count:12,size:22,spread:40,delay:2})]},
 'Hit impact':{icon:'sparks',category:impacts,duration:12,target:'figure',effects:[
  particles({emission:BURST,count:1,life:7,look:LOOK.burst,color:life([0,[255,255,255]],[1,[255,222,96]]),size:24,speed:0,spread:0,endSize:1.4,variation:0,fade:.3,blend:SOLID}),
  sparks(),puff(0xd8d0c8,{count:5,size:10,life:22}),
  ['tint',{color:0xffffff,mix:.7}]]},
 'Sword clash':{icon:'sparkle',category:impacts,duration:16,effects:[
  particles({emission:BURST,count:1,life:8,look:LOOK.star,color:0xffffff,size:30,speed:0,spread:0,endSize:.3,variation:0,glow:1.2}),
  sparks(life([0,[255,255,255]],[.5,[255,220,120]],[1,[255,120,30]]),{count:26,ground:1}),
  particles({emission:BURST,count:1,life:10,look:LOOK.ring,color:0xfff1c0,size:10,speed:0,spread:0,endSize:5,variation:0,fade:.8})]},
 'Gunshot':{icon:'glow',category:impacts,duration:14,effects:[
  particles({emission:BURST,count:1,life:3,look:LOOK.star,color:0xfff0b0,size:22,speed:0,spread:0,endSize:1.5,variation:0,glow:1}),
  sparks(WHITE_HOT(255,210,110),{count:8,direction:0,spread:40,speed:14,gravity:.1}),
  smoke({emission:BURST,count:6,size:8,rise:.6,life:28,spread:4,color:0x9a9aa0,delay:1})]},
 'Splatter':{icon:'tint',category:impacts,duration:30,effects:[
  particles({emission:BURST,count:1,life:40,look:LOOK.splat,color:0xb3122a,size:18,speed:0,spread:0,endSize:1,variation:.2,fade:.3,blend:SOLID}),
  particles({emission:BURST,count:24,life:30,look:LOOK.drop,color:0xb3122a,size:3.5,speed:8,spread:140,gravity:.4,drag:.02,endSize:.8,variation:.6,fade:.2,ground:1,blend:SOLID}),
  particles({emission:BURST,count:6,life:36,look:LOOK.splat,color:0x8e0e21,size:5,speed:4,spread:360,drag:.1,endSize:1,variation:.5,fade:.2,blend:SOLID,delay:2})]},

 'Energy blast':{icon:'beam',category:power,duration:48,effects:[
  beam({}),
  particles({rate:6,life:14,look:LOOK.star,color:0x9fe8ff,size:5,speed:0,shape:CIRCLE,radius:34,swirl:14,endSize:.2,variation:.5,twinkle:.4,fade:.4,space:FOLLOW}),
  ['glow',{color:0x4fd2ff,radius:14,intensity:1.2}]]},
 'Power surge':{icon:'aura',category:power,duration:72,target:'figure',effects:[
  aura({style:7,color:0x7fd7ff}),
  explosion({style:2,color:0x5ad8ff,size:.7,smoke:0,debris:0}),
  particles({rate:.8,life:70,look:LOOK.rock,color:0x6d625a,size:4,speed:.8,direction:-90,spread:30,gravity:-.01,shape:LINE,radius:60,spin:3,variation:.6,fade:.2,blend:SOLID}),
  ['glow',{color:0x7fd7ff,radius:12,intensity:1}]]},
 'Transformation':{icon:'lightning',category:power,duration:84,target:'figure',effects:[
  aura({style:0,height:1.4,intensity:1.2}),
  particles({rate:.7,life:4,look:LOOK.bolt,color:0xfff2a0,size:26,speed:0,shape:BODY,radius:12,variation:.4,fade:.3}),
  explosion({style:6,color:0xffe27a,size:.9,debris:0,smoke:0,dust:0,delay:30}),
  ['tint',{color:0xffd24a,mix:.35}]]},
 'Lightning strike':{icon:'lightning',category:power,duration:24,effects:[
  particles({emission:BURST,count:3,life:5,look:LOOK.bolt,color:0xd9d0ff,size:46,speed:0,spread:0,shape:CIRCLE,radius:10,variation:.3,fade:.3,twinkle:.6}),
  explosion({style:6,color:0xa47cff,size:.9,dust:0,smoke:.5}),
  particles({emission:BURST,count:1,life:5,look:LOOK.glow,color:0xffffff,size:160,speed:0,spread:0,endSize:1.3,variation:0,fade:.9})]},
 'Fire breath':{icon:'fire',category:power,duration:48,effects:[
  beam({style:5,color:0xff7a1a,width:26,charge:4,travel:8,arcs:0}),
  particles({rate:2,life:40,look:LOOK.glow,color:EMBERS,size:2,speed:1.2,spread:80,gravity:-.04,flow:20,twinkle:.6,endSize:.3,variation:.6,fade:.5}),
  smoke({amount:1.2,size:16,rise:1.2,life:50,color:0x5c5658,delay:4})]},
 'Laser shot':{icon:'beam',category:power,duration:30,effects:[
  beam({style:1,color:0xff3148,width:6,wobble:0,charge:6,travel:2,arcs:0}),
  particles({rate:3,life:6,look:LOOK.star,color:0xff9aa6,size:12,speed:0,spread:0,endSize:.6,variation:.3,glow:.8,space:FOLLOW})]},

 'Magic spell':{icon:'sparkle',category:magic,duration:48,effects:[
  particles({rate:8,life:30,look:LOOK.star,colorMode:1,color:spectrum([255,140,230],[160,120,255],[110,210,255]),size:6,speed:.6,spread:360,shape:CIRCLE,radius:40,swirl:6,twinkle:.5,endSize:0,variation:.6,fade:.5}),
  explosion({style:7,color:0xd67bff,size:.7,dust:0,delay:20}),
  ['glow',{color:0xc07bff,radius:14,intensity:1.1}]]},
 'Heal':{icon:'sparkle',category:magic,duration:60,target:'figure',effects:[
  aura({style:3,color:0xb6ffb0,intensity:.8,density:.7}),
  particles({rate:3,life:40,look:LOOK.star,color:life([0,[220,255,200]],[1,[80,220,120],0]),size:6,speed:1.2,spread:30,gravity:-.03,shape:BODY,endSize:.4,variation:.6,twinkle:.5,fade:.5}),
  ['glow',{color:0x7dff9a,radius:12,intensity:1}]]},
 'Teleport':{icon:'dissolve',category:magic,duration:24,effects:[
  explosion({style:7,color:0x6fd8ff,size:.8,dust:0,smoke:.4}),
  particles({emission:BURST,count:40,life:26,look:LOOK.star,color:0xc8f4ff,size:5,speed:3,direction:-90,spread:120,gravity:-.05,drag:.04,twinkle:.6,endSize:0,variation:.6,trail:2}),
  ['glow',{color:0x49dcff,intensity:1.4,radius:12}]]},
 'Portal':{icon:'shockwave',category:magic,duration:72,effects:[
  particles({rate:2,life:20,look:LOOK.glow,color:0x7a4dff,size:46,speed:0,spread:0,endSize:1.1,variation:.2,fade:.5}),
  particles({rate:18,life:30,look:LOOK.wisp,colorMode:1,color:spectrum([150,90,255],[80,200,255]),size:14,speed:.5,spread:360,swirl:-7,flow:10,shape:CIRCLE,radius:60,endSize:.3,variation:.4,fade:.5,rotation:2}),
  particles({rate:4,life:24,look:LOOK.star,color:0xd8c8ff,size:4,speed:.3,spread:360,swirl:-9,shape:CIRCLE,radius:30,twinkle:.7,endSize:.3,variation:.5,fade:.4})]},
 'Dark curse':{icon:'aura',category:magic,duration:72,target:'figure',effects:[
  aura({style:2,color:0x8a4dff}),
  smoke({style:1,color:0x2a1f3a,amount:1.5,size:20,rise:.4,life:70,spread:30}),
  ['tint',{color:0x5b2a8f,mix:.45}]]},
 'Frozen':{icon:'snow',category:magic,duration:72,target:'figure',effects:[
  aura({style:4,color:0x9fe6ff,density:.7}),
  particles({rate:2,life:60,look:LOOK.flake,color:0xe8f8ff,size:4,speed:.6,spread:360,gravity:.01,spin:4,shape:BODY,endSize:.8,variation:.5,fade:.3}),
  ['tint',{color:{type:'linear',angle:90,stops:[{offset:0,color:[60,135,255],opacity:1},{offset:1,color:[210,255,255],opacity:1}]},mix:.6}]]},
 'Love struck':{icon:'sparkle',category:magic,duration:72,effects:[
  particles({rate:1.5,life:50,look:LOOK.heart,color:0xff5a8a,size:7,speed:1,spread:40,gravity:-.02,endSize:.9,sizeMode:POP,variation:.4,flow:16,fade:.3,outline:1,outlineWidth:1.2,outlineColor:0x5a0f22,blend:SOLID}),
  particles({rate:3,life:30,look:LOOK.star,color:0xffb3d0,size:4,speed:.8,spread:360,twinkle:.7,endSize:0,variation:.6,shape:CIRCLE,radius:30})]},
 'Dizzy':{icon:'sparkle',category:magic,duration:72,effects:[
  particles({rate:.12,life:42,look:LOOK.toonStar,color:0xffd83a,size:7,speed:0,spread:0,shape:CIRCLE,radius:26,endSize:1,sizeMode:POP,swirl:9,space:FOLLOW,outline:1,outlineWidth:1.6,variation:.2,fade:0,blend:SOLID}),
  particles({rate:1.5,life:20,look:LOOK.star,color:0xfff6c0,size:3,speed:0,spread:0,shape:CIRCLE,radius:30,swirl:9,twinkle:.8,endSize:0,variation:.4,space:FOLLOW})]},
 'Fight cloud':{icon:'smoke',category:magic,duration:48,effects:[
  smoke({style:3,emission:BURST,count:14,color:0xe6e2ea,size:30,rise:.3,life:40,spread:40}),
  particles({rate:1.2,life:14,look:LOOK.toonStar,color:0xffd83a,size:6,speed:4,spread:360,drag:.1,sizeMode:POP,spin:10,outline:1,outlineWidth:1.4,blend:SOLID,shape:CIRCLE,radius:40}),
  particles({rate:.8,life:8,look:LOOK.burst,color:0xffffff,size:14,speed:0,spread:0,sizeMode:POP,outline:1,outlineWidth:1.6,blend:SOLID,shape:CIRCLE,radius:50})]},
 'Dash':{icon:'speed',category:magic,duration:24,effects:[
  puff(0xc8bca8,{count:10,size:16,spread:20}),
  particles({rate:30,life:10,look:LOOK.glow,color:life([0,[200,230,255]],[1,[120,160,255],0]),size:6,speed:0,spread:0,endSize:.2,variation:.1,fade:.6}),
  particles({rate:4,life:8,look:LOOK.spark,color:0xffffff,size:1.4,speed:30,direction:180,spread:10,stretch:1.6,endSize:1,variation:.4,fade:.4,shape:CIRCLE,radius:40})]},

 'Campfire':{icon:'fire',category:fire,duration:null,effects:[
  smoke({amount:1.2,size:22,rise:1.4,life:80,color:0x6e6a70,spread:10}),
  particles({rate:16,life:24,look:LOOK.flame,color:FLAME,size:16,speed:2,spread:24,gravity:-.12,endSize:.3,variation:.5,flow:12,fade:.4,shape:LINE,radius:18}),
  particles({rate:1.5,life:50,look:LOOK.glow,color:EMBERS,size:2,speed:1.8,spread:40,gravity:-.04,endSize:.3,variation:.6,flow:30,twinkle:.6,fade:.5})]},
 'Burning':{icon:'fire',category:fire,duration:72,target:'figure',effects:[
  aura({style:0,color:0xff9a2a,height:1.2}),
  smoke({amount:2,size:18,rise:1.6,life:60,color:0x3e393c,spread:20}),
  particles({rate:2.5,life:50,look:LOOK.glow,color:EMBERS,size:2,speed:1.6,spread:60,gravity:-.04,flow:30,twinkle:.6,endSize:.3,variation:.6,fade:.5,shape:BODY})]},
 'Torch':{icon:'fire',category:fire,duration:72,effects:[
  particles({rate:10,life:16,look:LOOK.flame,color:FLAME,size:7,speed:1.6,spread:20,gravity:-.1,endSize:.3,variation:.4,flow:8,fade:.4}),
  particles({rate:.8,life:40,look:LOOK.glow,color:EMBERS,size:1.6,speed:1.4,spread:50,gravity:-.04,flow:20,twinkle:.6,endSize:.3,variation:.6,fade:.5}),
  smoke({amount:.8,size:8,rise:1.4,life:40,color:0x6a6468,growth:4})]},
 'Smoking wreck':{icon:'smoke',category:fire,duration:null,effects:[
  smoke({style:1,amount:2,size:28,rise:1.3,life:120,color:0x353236,spread:20}),
  particles({rate:6,life:18,look:LOOK.flame,color:FLAME,size:9,speed:1.4,spread:30,gravity:-.1,endSize:.3,variation:.5,flow:10,fade:.4,shape:LINE,radius:24}),
  particles({rate:1,life:60,look:LOOK.glow,color:EMBERS,size:1.8,speed:1.5,spread:50,gravity:-.03,flow:30,twinkle:.6,endSize:.3,variation:.6,fade:.5})]},
 'Steam vent':{icon:'smoke',category:fire,duration:72,effects:[
  smoke({style:2,color:0xe8eef2,amount:3,size:18,rise:3,life:40,spread:4}),
  particles({rate:3,life:18,look:LOOK.drop,color:0xcfe6f5,size:2,speed:5,direction:-90,spread:50,gravity:.3,endSize:.6,variation:.6,fade:.4,blend:SOLID})]},
 'Smoke bomb':{icon:'smoke',category:fire,duration:72,effects:[
  explosion({style:3,color:0x8d8a99}),
  smoke({style:1,color:0x7f7c88,amount:1.5,size:36,rise:.5,life:100,spread:40,delay:10}),
  sparks(WHITE_HOT(255,200,120),{count:14})]},

 'Rain':{icon:'rain',category:stage,duration:null,target:'scene',effects:[
  particles({rate:25,life:45,look:LOOK.spark,color:life([0,[170,200,255],.7],[1,[170,200,255],.5]),size:1,speed:22,direction:100,spread:2,endSize:1,variation:.2,stretch:1.4,fade:.1,shape:LINE,radius:0,y:0}),
  particles({rate:8,life:8,look:LOOK.drop,color:0xb8cdf0,size:1.6,speed:2.2,direction:-90,spread:80,gravity:.3,endSize:.6,variation:.5,fade:.5,shape:LINE,radius:2000,y:1,blend:SOLID}),
  smoke({effectStrength:.35,color:0x9aa6b8,amount:.2,size:140,rise:0,wind:.4,life:240,spread:700,growth:1.4,y:.9})]},
 'Thunderstorm':{icon:'lightning',category:stage,duration:null,target:'scene',effects:[
  particles({rate:40,life:40,look:LOOK.spark,color:life([0,[160,190,240],.7],[1,[160,190,240],.5]),size:1,speed:26,direction:105,spread:3,endSize:1,variation:.2,stretch:1.4,fade:.1,shape:LINE,radius:0,y:0}),
  particles({rate:.03,life:6,look:LOOK.glow,color:0xe6ecff,size:400,speed:0,spread:0,endSize:1,variation:0,twinkle:.9,fade:.9,y:.2}),
  particles({rate:.03,life:5,look:LOOK.bolt,color:0xe8e4ff,size:120,speed:0,spread:0,endSize:1,variation:.3,twinkle:.6,shape:LINE,radius:500,y:.25}),
  smoke({effectStrength:.4,color:0x707888,amount:.2,size:160,rise:0,wind:.6,life:240,spread:700,growth:1.4,y:.9})]},
 'Snowfall':{icon:'snow',category:stage,duration:null,target:'scene',effects:[
  particles({rate:5,life:220,look:LOOK.flake,color:life([0,[225,236,252]],[1,[225,236,252],.8]),size:4,speed:1.4,direction:90,spread:24,endSize:1,variation:.5,turbulence:40,spin:3,fade:.1,shape:LINE,radius:0,y:0}),
  particles({rate:8,life:240,look:LOOK.glow,color:0xe6eefa,size:1.6,speed:1,direction:90,spread:30,endSize:1,variation:.5,turbulence:30,fade:.1,shape:LINE,radius:0,y:0}),
  smoke({effectStrength:.4,color:0xdfe6ef,amount:.2,size:140,rise:0,wind:.3,life:260,spread:700,growth:1.3,y:.95})]},
 'Autumn wind':{icon:'wave',category:stage,duration:null,target:'scene',effects:[
  particles({rate:1.2,life:200,look:LOOK.leaf,colorMode:1,color:spectrum([214,120,40],[240,180,60],[170,70,40],[140,160,60]),size:8,speed:2,direction:20,spread:30,turbulence:60,spin:4,endSize:1,variation:.5,fade:.1,shape:LINE,radius:0,y:0,blend:SOLID}),
  particles({rate:3,life:90,look:LOOK.dot,color:0xb9a88f,size:1.4,speed:3.5,direction:15,spread:20,turbulence:30,endSize:1,variation:.6,fade:.3,shape:LINE,radius:0,y:0,effectStrength:.6,blend:SOLID})]},
 'Cherry blossoms':{icon:'sparkle',category:stage,duration:null,target:'scene',effects:[
  particles({rate:2,life:200,look:LOOK.petal,colorMode:1,color:spectrum([255,190,210],[255,160,190],[255,220,230]),size:5,speed:1.6,direction:110,spread:30,turbulence:50,spin:5,endSize:1,variation:.5,fade:.1,shape:LINE,radius:0,y:0,blend:SOLID}),
  particles({rate:1,life:160,look:LOOK.bokeh,color:0xffe0ec,size:3,speed:.8,direction:100,spread:40,turbulence:40,twinkle:.6,endSize:1,variation:.5,fade:.2,shape:LINE,radius:0,y:0})]},
 'Embers and ash':{icon:'fire',category:stage,duration:null,target:'scene',effects:[
  particles({rate:3,life:120,look:LOOK.glow,color:EMBERS,size:2.2,speed:1.2,direction:-90,spread:30,flow:40,twinkle:.6,endSize:.4,variation:.6,fade:.3,shape:LINE,radius:0}),
  particles({rate:3,life:220,look:LOOK.dot,color:0x5a5456,size:1.8,speed:.8,direction:95,spread:40,turbulence:40,endSize:1,variation:.5,fade:.2,shape:LINE,radius:0,y:0,blend:SOLID}),
  smoke({effectStrength:.3,color:0x5a4a44,amount:.2,size:160,rise:.2,wind:.4,life:260,spread:700,growth:1.4,y:.95})]},
 'Fog bank':{icon:'smoke',category:stage,duration:null,target:'scene',effects:[
  smoke({effectStrength:.6,color:0xb8bcc6,amount:.3,size:120,rise:0,wind:1.2,life:300,spread:600,growth:1.6,y:.8}),
  smoke({effectStrength:.35,color:0xd0d4dc,amount:.2,size:180,rise:0,wind:.6,life:300,spread:700,growth:1.3,y:.95})]},
 'Fireworks show':{icon:'sparkle',category:stage,duration:120,target:'scene',effects:[
  explosion({style:5,color:spectrum([255,80,120],[255,200,60],[90,220,130]),x:.3,y:.3,dust:0}),
  explosion({style:5,color:spectrum([70,170,255],[190,110,255],[255,255,255]),x:.7,y:.25,dust:0,delay:24}),
  explosion({style:5,color:spectrum([255,200,60],[255,120,40],[255,255,200]),x:.5,y:.35,size:1.3,dust:0,delay:50}),
  smoke({effectStrength:.3,color:0x8a8894,amount:.2,size:120,rise:.1,wind:.3,life:200,spread:500,growth:1.3,y:.3,delay:20})]},
 'Underwater':{icon:'rain',category:stage,duration:null,target:'scene',effects:[
  particles({rate:3,life:160,look:LOOK.ring,color:0xcff2ff,size:4,speed:1.2,direction:-90,spread:20,turbulence:30,endSize:1.5,variation:.6,fade:.2,shape:LINE,radius:0,y:1}),
  particles({rate:6,life:200,look:LOOK.dot,color:0x9fd6e8,size:1.2,speed:.4,direction:-80,spread:60,turbulence:50,twinkle:.5,endSize:1,variation:.6,fade:.3,shape:LINE,radius:0,y:1})]},
 'Speed lines':{icon:'speed',category:stage,duration:24,target:'scene',effects:[
  particles({rate:5,life:10,look:LOOK.spark,color:life([0,[136,144,160],.9],[1,[136,144,160],.5]),size:1.4,speed:70,direction:180,spread:3,endSize:1,variation:.4,stretch:2,fade:.3,shape:LINE,radius:0}),
  particles({rate:1.5,life:12,look:LOOK.spark,color:0xdfe4ec,size:3,speed:45,direction:180,spread:3,endSize:1,variation:.4,stretch:1.4,fade:.4,shape:LINE,radius:0,effectStrength:.35})]},

 'Power up':{icon:'glow',category:looks,effects:[['glow',{color:gradient([80,150,255],[160,60,255]),radius:20,intensity:1.5,spread:2,coreColor:0xffffff,coreMix:.25}],['wave',{strength:2,wavelength:80}]]},
 'Teleport':{icon:'dissolve',category:looks,effects:[['dissolve',{progress:.4,color:gradient([30,240,255],[100,80,255]),edge:.12}],['glow',{color:0x49dcff,intensity:1.4,radius:10}]]},
 'Impact':{icon:'rgbSplit',category:looks,effects:[['tint',{color:0xffffff,mix:.6}],['rgbSplit',{amount:8,angle:15}],['blur',{mode:1,radius:3,angle:15}]]},
 'Hologram':{icon:'crt',category:looks,effects:[['tint',{color:0x31dfff,mix:.8}],['rgbSplit',{amount:2}],['noise',{amount:.08,colored:1}],['glow',{color:0x2dcfff,radius:8,intensity:.8}]]},
 'Ice':{icon:'outline',category:looks,effects:[['tint',{color:gradient([60,135,255],[210,255,255]),mix:.8}],['outline',{color:0xbaf5ff,width:2}],['lightSweep',{intensity:.7}]]},
 'Poison':{icon:'wave',category:looks,effects:[['tint',{color:gradient([170,255,50],[60,150,20]),mix:.8}],['glow',{color:0x8bff22,radius:14,intensity:1.2}],['wave',{strength:2,wavelength:60}]]},
 'Neon':{icon:'glow',category:looks,effects:[['outline',{color:gradient([255,50,150],[70,200,255]),width:3,only:1}],['glow',{color:0xea40ff,radius:16,intensity:1.2}]]},
 'Golden hour':{icon:'bloom',category:looks,effects:[['grade',{temperature:.5,shadows:.15,highlights:-.1,saturation:.85}],['bloom',{threshold:.7,intensity:.6,color:gradient([255,220,150],[255,160,100])}]]},
 'Retro screen':{icon:'crt',category:looks,effects:[['grade',{saturation:.65,temperature:.2}],['pixelate',{size:4}],['noise',{amount:.08}],['crt',{amount:.2,curvature:.06,chromatic:1}]]},
 'Energy':{icon:'glow',category:looks,effects:[['tint',{color:0x55ccff,mix:.65}],['glow',{color:0x55ccff,radius:16,intensity:1.2}]]},
 'Hit flash':{icon:'lightSweep',category:looks,effects:[['tint',{color:0xffffff,mix:1}],['glow',{color:0xffffff,radius:6,intensity:.7}]]},
 'Ghost':{icon:'blur',category:looks,effects:[['tint',{color:0x99bbff,mix:.75}],['blur',{radius:2}]]},
 'Retro':{icon:'pixelate',category:looks,effects:[['grade',{saturation:.65,temperature:.2}],['pixelate',{size:5}],['noise',{amount:.12}]]},
};
/** Catalogue order of preset categories; generated effects come first. */
export const PRESET_CATEGORIES=[impacts,power,magic,fire,stage,looks];
/** Default length of a newly added generated effect, in frames. */
export const GENERATOR_DURATIONS={particles:48,aura:72,beam:48,explosion:36,smoke:72};
/** Whether a preset can be applied to this kind of target. */
export const presetAvailable=(preset,scene,effectAvailable)=>(!preset.target||preset.target===(scene?'scene':'figure'))&&preset.effects.every(([type])=>effectAvailable(type,scene));
