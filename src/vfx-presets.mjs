const gradient=(a,b)=>({type:'linear',angle:90,stops:[{offset:0,color:a,opacity:1},{offset:1,color:b,opacity:1}]});
/** Colour over a particle's life: [offset, [r,g,b], opacity]. */
const life=(...stops)=>({type:'linear',angle:0,stops:stops.map(([offset,color,opacity=1])=>({offset,color,opacity}))});
const looks='Looks',energy='Particles & energy',weather='Stage';
/** Presets install ordinary editable effects. Generated presets start at the
 * playhead for `duration` frames (null plays for the whole animation) and may
 * be limited to figure or stage targets. */
export const VFX_PRESETS={
 'Aura':{icon:'aura',category:energy,duration:72,target:'figure',effects:[['aura',{}]]},
 'Energy blast':{icon:'beam',category:energy,duration:48,effects:[['beam',{}]]},
 'Explosion':{icon:'explosion',category:energy,duration:36,effects:[['explosion',{}]]},
 'Lightning':{icon:'lightning',category:energy,duration:24,effects:[['beam',{color:0xa47cff,width:7,intensity:1.5,charge:0,travel:2,wobble:2.4,arcs:6,sparks:.6,chargeParticles:0,orb:0}]]},
 'Impact sparks':{icon:'sparks',category:energy,duration:18,effects:[['particles',{emission:1,count:60,life:16,look:1,color:life([0,[255,255,255]],[.4,[255,210,90]],[1,[255,90,20],0]),size:2.2,speed:10,spread:360,gravity:.3,endSize:.4,variation:.6,stretch:2.2,fade:.3,drag:.03,ground:1}]]},
 'Dust puff':{icon:'smoke',category:energy,duration:30,effects:[['particles',{emission:1,count:22,life:40,look:5,color:life([0,[196,182,164],.8],[1,[170,160,150],0]),size:10,speed:2.6,spread:200,gravity:-.01,endSize:3.2,variation:.6,drag:.08,fade:.6,blend:2,radius:8,ground:1}]]},
 'Smoke':{icon:'smoke',category:energy,duration:72,effects:[['particles',{rate:3,life:50,look:5,color:life([0,[120,118,124],.7],[1,[150,148,154],0]),size:9,speed:1.2,spread:50,gravity:-.03,endSize:4,variation:.5,turbulence:24,fade:.5,blend:2}]]},
 'Fire':{icon:'fire',category:energy,duration:72,effects:[['particles',{rate:14,life:22,color:life([0,[255,245,200]],[.25,[255,200,60]],[.6,[255,90,20]],[1,[140,20,10],0]),size:9,speed:2.2,spread:30,gravity:-.14,endSize:.25,variation:.5,turbulence:12,fade:.4,shape:1,radius:10}]]},
 'Magic sparkles':{icon:'sparkle',category:energy,duration:72,effects:[['particles',{life:40,colorMode:1,color:life([0,[255,110,210]],[.33,[90,180,255]],[.66,[110,230,130]],[1,[255,210,60]]),size:5,rate:6,speed:.8,spread:360,gravity:-.02,endSize:0,variation:.7,turbulence:18,fade:.6,shape:1,radius:34}]]},
 'Confetti':{icon:'confetti',category:energy,duration:30,effects:[['particles',{emission:1,count:120,life:90,look:4,colorMode:1,color:life([0,[255,80,120]],[.25,[255,200,40]],[.5,[80,210,120]],[.75,[60,160,255]],[1,[190,110,255]]),size:5,speed:9,spread:120,gravity:.18,drag:.02,turbulence:30,endSize:1,variation:.6,fade:.2,ground:1,blend:2}]]},
 'Rain':{icon:'rain',category:weather,duration:null,target:'scene',effects:[['particles',{rate:25,life:45,look:1,color:life([0,[170,200,255],.7],[1,[170,200,255],.5]),size:1,speed:22,direction:100,spread:2,endSize:1,variation:.2,stretch:1.4,fade:.1,shape:3,radius:0,y:0}]]},
 'Snow':{icon:'snow',category:weather,duration:null,target:'scene',effects:[['particles',{rate:6,life:220,color:life([0,[200,214,236]],[1,[200,214,236],.8]),size:3,speed:1.4,direction:90,spread:24,endSize:1,variation:.5,turbulence:40,fade:.1,shape:3,radius:0,y:0}]]},
 'Speed lines':{icon:'speed',category:weather,duration:24,target:'scene',effects:[['particles',{rate:5,life:10,look:1,color:life([0,[136,144,160],.9],[1,[136,144,160],.5]),size:1.4,speed:70,direction:180,spread:3,endSize:1,variation:.4,stretch:2,fade:.3,shape:3,radius:0}]]},
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
/** Default length of a newly added generated effect, in frames. */
export const GENERATOR_DURATIONS={particles:48,aura:72,beam:48,explosion:36};
/** Whether a preset can be applied to this kind of target. */
export const presetAvailable=(preset,scene,effectAvailable)=>(!preset.target||preset.target===(scene?'scene':'figure'))&&preset.effects.every(([type])=>effectAvailable(type,scene));
