const gradient=(a,b)=>({type:'linear',angle:90,stops:[{offset:0,color:a,opacity:1},{offset:1,color:b,opacity:1}]});
/** Colour over a particle's life: [offset, [r,g,b], opacity]. */
const life=(...stops)=>({type:'linear',angle:0,stops:stops.map(([offset,color,opacity=1])=>({offset,color,opacity}))});
const spectrum=(...colors)=>life(...colors.map((color,i)=>[i/(colors.length-1),color]));
const looks='Looks',explosions='Explosions',auras='Auras',beams='Beams',impacts='Impacts',fire='Fire & smoke',magic='Magic & cartoon',stage='Stage';
const EMBERS=life([0,[255,245,200]],[.3,[255,190,70]],[.7,[255,90,20]],[1,[140,20,10],0]);
const FLAME=life([0,[255,245,200]],[.25,[255,200,60]],[.6,[255,90,20]],[1,[140,20,10],0]);
// Particle option indices, in registry order.
const LOOK={glow:0,spark:1,dot:2,ring:3,shard:4,smoke:5,star:6,bokeh:7,flame:8,cloud:9,toonFlame:10,leaf:11,petal:12,flake:13,drop:14,heart:15,toonStar:16,pixel:17,bolt:18,wisp:19,rock:20,splat:21,burst:22};
const POP=3,CIRCLE=1,BODY=2,LINE=3,FOLLOW=1,SOLID=2;
/** Presets install ordinary editable effects. Generated presets start at the
 * playhead for `duration` frames (null plays for the whole animation) and may
 * be limited to figure or stage targets. */
export const VFX_PRESETS={
 'Explosion':{icon:'explosion',category:explosions,duration:36,effects:[['explosion',{}]]},
 'Cartoon explosion':{icon:'explosion',category:explosions,duration:30,effects:[['explosion',{style:1,color:0xff9d2a}]]},
 'Plasma burst':{icon:'glow',category:explosions,duration:36,effects:[['explosion',{style:2,color:0x5ad8ff}]]},
 'Smoke bomb':{icon:'smoke',category:explosions,duration:60,effects:[['explosion',{style:3,color:0x8d8a99}]]},
 'Mushroom cloud':{icon:'smoke',category:explosions,duration:96,effects:[['explosion',{style:4,color:0xff7a2a,size:1.3}]]},
 'Fireworks':{icon:'sparkle',category:explosions,duration:48,effects:[['explosion',{style:5,color:spectrum([255,80,120],[255,200,60],[90,220,130],[70,170,255],[190,110,255])}]]},
 'Electric burst':{icon:'lightning',category:explosions,duration:30,effects:[['explosion',{style:6,color:0x7fc8ff}]]},
 'Magic burst':{icon:'sparkle',category:explosions,duration:36,effects:[['explosion',{style:7,color:0xd67bff}]]},
 'Dust burst':{icon:'smoke',category:explosions,duration:48,effects:[['explosion',{style:8,color:0xb49a7c}]]},
 'Pixel explosion':{icon:'pixelate',category:explosions,duration:30,effects:[['explosion',{style:9,color:0xff7a2a,step:1}]]},

 'Aura':{icon:'aura',category:auras,duration:72,target:'figure',effects:[['aura',{}]]},
 'Electric aura':{icon:'lightning',category:auras,duration:72,target:'figure',effects:[['aura',{style:1,color:0x6fd8ff}]]},
 'Shadow aura':{icon:'aura',category:auras,duration:72,target:'figure',effects:[['aura',{style:2,color:0x8a4dff}]]},
 'Holy aura':{icon:'glow',category:auras,duration:72,target:'figure',effects:[['aura',{style:3,color:0xffe7a0}]]},
 'Ice aura':{icon:'snow',category:auras,duration:72,target:'figure',effects:[['aura',{style:4,color:0x9fe6ff}]]},
 'Wind aura':{icon:'turbulence',category:auras,duration:72,target:'figure',effects:[['aura',{style:5,color:0xb8f0d0}]]},
 'Cartoon aura':{icon:'fire',category:auras,duration:72,target:'figure',effects:[['aura',{style:6,color:0xffb000}]]},
 'Spirit aura':{icon:'aura',category:auras,duration:72,target:'figure',effects:[['aura',{style:7,color:0x7fd7ff}]]},

 'Energy blast':{icon:'beam',category:beams,duration:48,effects:[['beam',{}]]},
 'Laser':{icon:'beam',category:beams,duration:36,effects:[['beam',{style:1,color:0xff3148,width:6,wobble:0,charge:6,travel:2,arcs:0}]]},
 'Cartoon beam':{icon:'beam',category:beams,duration:48,effects:[['beam',{style:2,color:0xffd23c,width:22,wobble:.6,charge:10,travel:5,arcs:0}]]},
 'Spiral beam':{icon:'beam',category:beams,duration:48,effects:[['beam',{style:3,color:0xb06bff,width:18,wobble:.8,arcs:2}]]},
 'Lightning':{icon:'lightning',category:beams,duration:24,effects:[['beam',{style:4,color:0xa47cff,width:7,intensity:1.5,charge:0,travel:2,wobble:2.4,arcs:6,sparks:.6,chargeParticles:0,orb:0}]]},
 'Fire breath':{icon:'fire',category:beams,duration:48,effects:[['beam',{style:5,color:0xff7a1a,width:26,charge:4,travel:8,arcs:0}]]},

 'Impact sparks':{icon:'sparks',category:impacts,duration:18,effects:[['particles',{emission:1,count:60,life:16,look:LOOK.spark,color:life([0,[255,255,255]],[.4,[255,210,90]],[1,[255,90,20],0]),size:2.2,speed:10,spread:360,gravity:.3,endSize:.4,variation:.6,stretch:2.2,fade:.3,drag:.03,ground:1}]]},
 'Hit spark':{icon:'explosion',category:impacts,duration:12,effects:[
  ['particles',{emission:1,count:1,life:7,look:LOOK.burst,color:life([0,[255,255,255]],[1,[255,222,96]]),size:24,speed:0,spread:0,endSize:1.4,variation:0,fade:.3,blend:SOLID}],
  ['particles',{emission:1,count:14,life:8,look:LOOK.spark,color:life([0,[255,255,255]],[1,[255,200,80]]),size:2.6,speed:16,spread:360,drag:.12,endSize:.3,stretch:2.4,variation:.4,fade:.4}]]},
 'Sword clash':{icon:'sparkle',category:impacts,duration:16,effects:[
  ['particles',{emission:1,count:1,life:8,look:LOOK.star,color:0xffffff,size:30,speed:0,spread:0,endSize:.3,variation:0,glow:1.2}],
  ['particles',{emission:1,count:30,life:14,look:LOOK.spark,color:life([0,[255,255,255]],[.5,[255,220,120]],[1,[255,120,30]]),size:2,speed:12,spread:360,gravity:.35,drag:.03,endSize:.3,stretch:2,fade:.4,ground:1}]]},
 'Ground slam':{icon:'shockwave',category:impacts,duration:40,effects:[['explosion',{style:8,color:0xb49a7c,size:1.2,debris:1.5,smoke:.6}]]},
 'Muzzle flash':{icon:'glow',category:impacts,duration:12,effects:[
  ['particles',{emission:1,count:1,life:3,look:LOOK.star,color:0xfff0b0,size:22,speed:0,spread:0,endSize:1.5,variation:0,glow:1}],
  ['smoke',{emission:1,count:6,size:8,rise:.6,life:24,spread:4,color:0x9a9aa0}]]},
 'Splatter':{icon:'tint',category:impacts,duration:30,effects:[
  ['particles',{emission:1,count:1,life:40,look:LOOK.splat,color:0xb3122a,size:18,speed:0,spread:0,endSize:1,variation:.2,fade:.3,blend:SOLID}],
  ['particles',{emission:1,count:24,life:30,look:LOOK.drop,color:0xb3122a,size:3.5,speed:8,spread:140,gravity:.4,drag:.02,endSize:.8,variation:.6,fade:.2,ground:1,blend:SOLID}]]},
 'Dust puff':{icon:'smoke',category:impacts,duration:30,effects:[['smoke',{style:4,emission:1,count:10,color:0xc4b6a4,size:14,life:36,spread:10}]]},

 'Fire':{icon:'fire',category:fire,duration:72,effects:[['particles',{rate:14,life:22,look:LOOK.flame,color:FLAME,size:12,speed:2.2,spread:30,gravity:-.14,endSize:.35,variation:.5,flow:14,fade:.4,shape:CIRCLE,radius:10}]]},
 'Campfire':{icon:'fire',category:fire,duration:null,effects:[
  ['smoke',{amount:1.2,size:22,rise:1.4,life:80,color:0x6e6a70,spread:10}],
  ['particles',{rate:16,life:24,look:LOOK.flame,color:FLAME,size:16,speed:2,spread:24,gravity:-.12,endSize:.3,variation:.5,flow:12,fade:.4,shape:LINE,radius:18}],
  ['particles',{rate:1.5,life:50,look:LOOK.glow,color:EMBERS,size:2,speed:1.8,spread:40,gravity:-.04,endSize:.3,variation:.6,flow:30,twinkle:.6,fade:.5}]]},
 'Torch':{icon:'fire',category:fire,duration:72,effects:[['particles',{rate:10,life:16,look:LOOK.flame,color:FLAME,size:7,speed:1.6,spread:20,gravity:-.1,endSize:.3,variation:.4,flow:8,fade:.4}]]},
 'Smoke':{icon:'smoke',category:fire,duration:72,effects:[['smoke',{}]]},
 'Thick smoke':{icon:'smoke',category:fire,duration:72,effects:[['smoke',{style:1,color:0x4a4650}]]},
 'Steam':{icon:'smoke',category:fire,duration:72,effects:[['smoke',{style:2,color:0xe8eef2}]]},
 'Cartoon smoke':{icon:'smoke',category:fire,duration:72,effects:[['smoke',{style:3,color:0xd9d6e0}]]},
 'Smoke trail':{icon:'smoke',category:fire,duration:72,effects:[['smoke',{amount:6,size:10,rise:.3,life:40,growth:2.5,spread:2}]]},

 'Magic sparkles':{icon:'sparkle',category:magic,duration:72,effects:[['particles',{life:40,look:LOOK.star,colorMode:1,color:life([0,[255,110,210]],[.33,[90,180,255]],[.66,[110,230,130]],[1,[255,210,60]]),size:7,rate:6,speed:.8,spread:360,gravity:-.02,endSize:0,variation:.7,flow:18,twinkle:.5,fade:.6,shape:CIRCLE,radius:34}]]},
 'Heal':{icon:'sparkle',category:magic,duration:60,target:'figure',effects:[
  ['particles',{rate:4,life:40,look:LOOK.star,color:life([0,[200,255,180]],[1,[80,220,120],0]),size:6,speed:1.2,spread:30,gravity:-.03,shape:BODY,endSize:.4,variation:.6,twinkle:.5,fade:.5}],
  ['particles',{rate:2,life:36,look:LOOK.bokeh,color:life([0,[170,255,190]],[1,[60,200,110],0]),size:4,speed:.8,spread:40,gravity:-.02,shape:BODY,endSize:.6,variation:.5,fade:.5}]]},
 'Portal':{icon:'shockwave',category:magic,duration:72,effects:[
  ['particles',{rate:2,life:20,look:LOOK.glow,color:0x7a4dff,size:46,speed:0,spread:0,endSize:1.1,variation:.2,fade:.5}],
  ['particles',{rate:18,life:30,look:LOOK.wisp,color:spectrum([150,90,255],[80,200,255]),colorMode:1,size:14,speed:.5,spread:360,swirl:-7,flow:10,shape:CIRCLE,radius:60,endSize:.3,variation:.4,fade:.5,rotation:2}]]},
 'Motion trail':{icon:'speed',category:magic,duration:48,effects:[['particles',{rate:40,life:10,look:LOOK.glow,color:life([0,[140,220,255]],[1,[80,120,255],0]),size:7,speed:0,spread:0,endSize:.2,variation:.1,fade:.6}]]},
 'Love':{icon:'sparkle',category:magic,duration:72,effects:[['particles',{rate:1.5,life:50,look:LOOK.heart,color:0xff5a8a,size:7,speed:1,spread:40,gravity:-.02,endSize:.9,sizeMode:POP,variation:.4,flow:16,fade:.3,outline:1,outlineWidth:1.2,outlineColor:0x5a0f22,blend:SOLID}]]},
 'Dizzy stars':{icon:'sparkle',category:magic,duration:72,effects:[['particles',{rate:.12,life:42,look:LOOK.toonStar,color:0xffd83a,size:7,speed:0,spread:0,shape:CIRCLE,radius:26,endSize:1,sizeMode:POP,swirl:9,space:FOLLOW,outline:1,outlineWidth:1.6,variation:.2,fade:0,blend:SOLID}]]},
 'Confetti':{icon:'confetti',category:magic,duration:30,effects:[['particles',{emission:1,count:120,life:90,look:LOOK.shard,colorMode:1,color:spectrum([255,80,120],[255,200,40],[80,210,120],[60,160,255],[190,110,255]),size:5,speed:9,spread:120,gravity:.18,drag:.02,turbulence:30,spin:8,endSize:1,variation:.6,fade:.2,ground:1,blend:SOLID}]]},

 'Rain':{icon:'rain',category:stage,duration:null,target:'scene',effects:[['particles',{rate:25,life:45,look:LOOK.spark,color:life([0,[170,200,255],.7],[1,[170,200,255],.5]),size:1,speed:22,direction:100,spread:2,endSize:1,variation:.2,stretch:1.4,fade:.1,shape:LINE,radius:0,y:0}]]},
 'Snow':{icon:'snow',category:stage,duration:null,target:'scene',effects:[['particles',{rate:6,life:220,look:LOOK.flake,color:life([0,[220,232,250]],[1,[220,232,250],.8]),size:4,speed:1.4,direction:90,spread:24,endSize:1,variation:.5,turbulence:40,spin:3,fade:.1,shape:LINE,radius:0,y:0}]]},
 'Falling leaves':{icon:'wave',category:stage,duration:null,target:'scene',effects:[['particles',{rate:1.2,life:200,look:LOOK.leaf,colorMode:1,color:spectrum([214,120,40],[240,180,60],[170,70,40],[140,160,60]),size:8,speed:1.4,direction:95,spread:30,turbulence:60,spin:4,endSize:1,variation:.5,fade:.1,shape:LINE,radius:0,y:0,blend:SOLID}]]},
 'Cherry blossoms':{icon:'sparkle',category:stage,duration:null,target:'scene',effects:[['particles',{rate:2,life:200,look:LOOK.petal,colorMode:1,color:spectrum([255,190,210],[255,160,190],[255,220,230]),size:5,speed:1.6,direction:110,spread:30,turbulence:50,spin:5,endSize:1,variation:.5,fade:.1,shape:LINE,radius:0,y:0,blend:SOLID}]]},
 'Embers':{icon:'fire',category:stage,duration:null,target:'scene',effects:[['particles',{rate:3,life:120,look:LOOK.glow,color:EMBERS,size:2.2,speed:1.2,direction:-90,spread:30,flow:40,twinkle:.6,endSize:.4,variation:.6,fade:.3,shape:LINE,radius:0}]]},
 'Fog':{icon:'smoke',category:stage,duration:null,target:'scene',effects:[['smoke',{effectStrength:.6,color:0xb8bcc6,amount:.3,size:120,rise:0,wind:1.2,life:300,spread:600,growth:1.6,y:.8}]]},
 'Speed lines':{icon:'speed',category:stage,duration:24,target:'scene',effects:[['particles',{rate:5,life:10,look:LOOK.spark,color:life([0,[136,144,160],.9],[1,[136,144,160],.5]),size:1.4,speed:70,direction:180,spread:3,endSize:1,variation:.4,stretch:2,fade:.3,shape:LINE,radius:0}]]},

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
export const PRESET_CATEGORIES=[explosions,auras,beams,impacts,fire,magic,stage,looks];
/** Default length of a newly added generated effect, in frames. */
export const GENERATOR_DURATIONS={particles:48,aura:72,beam:48,explosion:36,smoke:72};
/** Whether a preset can be applied to this kind of target. */
export const presetAvailable=(preset,scene,effectAvailable)=>(!preset.target||preset.target===(scene?'scene':'figure'))&&preset.effects.every(([type])=>effectAvailable(type,scene));
