const gradient=(a,b)=>({type:'linear',angle:90,stops:[{offset:0,color:a,opacity:1},{offset:1,color:b,opacity:1}]});
export const VFX_PRESETS={
 'Power up':{icon:'glow',effects:[['glow',{color:gradient([80,150,255],[160,60,255]),radius:20,intensity:1.5,spread:2,coreColor:0xffffff,coreMix:.25}],['wave',{strength:2,wavelength:80}]]},
 'Teleport':{icon:'dissolve',effects:[['dissolve',{progress:.4,color:gradient([30,240,255],[100,80,255]),edge:.12}],['glow',{color:0x49dcff,intensity:1.4,radius:10}]]},
 'Impact':{icon:'rgbSplit',effects:[['tint',{color:0xffffff,mix:.6}],['rgbSplit',{amount:8,angle:15}],['blur',{mode:1,radius:3,angle:15}]]},
 'Hologram':{icon:'crt',effects:[['tint',{color:0x31dfff,mix:.8}],['rgbSplit',{amount:2}],['noise',{amount:.08,colored:1}],['glow',{color:0x2dcfff,radius:8,intensity:.8}]]},
 'Ice':{icon:'outline',effects:[['tint',{color:gradient([60,135,255],[210,255,255]),mix:.8}],['outline',{color:0xbaf5ff,width:2}],['lightSweep',{intensity:.7}]]},
 'Poison':{icon:'wave',effects:[['tint',{color:gradient([170,255,50],[60,150,20]),mix:.8}],['glow',{color:0x8bff22,radius:14,intensity:1.2}],['wave',{strength:2,wavelength:60}]]},
 'Neon':{icon:'glow',effects:[['outline',{color:gradient([255,50,150],[70,200,255]),width:3,only:1}],['glow',{color:0xea40ff,radius:16,intensity:1.2}]]},
 'Golden hour':{icon:'bloom',effects:[['grade',{temperature:.5,shadows:.15,highlights:-.1,saturation:.85}],['bloom',{threshold:.7,intensity:.6,color:gradient([255,220,150],[255,160,100])}]]},
 'Retro screen':{icon:'crt',effects:[['grade',{saturation:.65,temperature:.2}],['pixelate',{size:4}],['noise',{amount:.08}],['crt',{amount:.2,curvature:.06,chromatic:1}]]},
 'Energy':{icon:'glow',effects:[['tint',{color:0x55ccff,mix:.65}],['glow',{color:0x55ccff,radius:16,intensity:1.2}]]},
 'Hit flash':{icon:'lightSweep',effects:[['tint',{color:0xffffff,mix:1}],['glow',{color:0xffffff,radius:6,intensity:.7}]]},
 'Ghost':{icon:'blur',effects:[['tint',{color:0x99bbff,mix:.75}],['blur',{radius:2}]]},
 'Retro':{icon:'pixelate',effects:[['grade',{saturation:.65,temperature:.2}],['pixelate',{size:5}],['noise',{amount:.12}]]},
};
