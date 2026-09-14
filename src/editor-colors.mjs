import {figurePalette, validateRecolor} from './figure-colors.mjs';
import {layerLocked,layerVisible} from './layers.mjs';

export const editorColorMethods={
  figurePalette(){return this.figure&&this.object?figurePalette(this.report,this.figure,this.object):[];},
  editFigureColors(operation,{indices,...options}={}){
    operation=validateRecolor({...operation,kind:'recolor'});
    const uids=options.uids??[...this.selectedUids];
    if(uids.some(uid=>layerLocked(this.report,uid)||!layerVisible(this.report,uid)))throw new Error('Show and unlock the selected layers before recoloring.');
    return this.applyFigureRange(operation,{...options,uids,...(indices?{indices}:this.propertyChannels&&!this.report._styk?.layerSheet?{ticks:[this.tick]}:{atPlayhead:true}),label:operation.mode==='replace'?'Replace figure color':operation.mode==='style'?'Edit segment colors':operation.mode==='reset'?'Reset figure colors':'Set figure color'});
  },
  setFigureColor(color,options={}){const {opacity,...range}=options;return this.editFigureColors({mode:'all',color,opacity},range);},
  replaceFigureColor(from,color,{targets,...options}={}){return this.editFigureColors({mode:'replace',from,color,targets,figureTypeId:this.figure?.figure_type_id},options);},
  resetFigureColors(options={}){return this.editFigureColors({mode:'reset'},options);},
};
