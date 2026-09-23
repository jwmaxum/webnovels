(function(root){
 'use strict';
 function dimensions(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width,height,type;
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)){
    if(view.getUint32(12)!==0x49484452)throw Error('IMAGE_INVALID');width=view.getUint32(16);height=view.getUint32(20);type='image/png';
  }else if(bytes[0]===255&&bytes[1]===216){
    type='image/jpeg';let offset=2;
    while(offset+4<=bytes.length){if(bytes[offset++]!==255)throw Error('IMAGE_INVALID');while(bytes[offset]===255)offset++;const marker=bytes[offset++];
      if(marker===217||marker===218)break;const size=view.getUint16(offset);if(size<2||offset+size>bytes.length)throw Error('IMAGE_INVALID');
      if([192,193,194].includes(marker)){if(size<7)throw Error('IMAGE_INVALID');height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;}offset+=size;
    }
  }
  if(!width||!height)throw Error('IMAGE_INVALID');if(width>8192||height>8192||width*height>12000000)throw Error('IMAGE_PIXEL_LIMIT');return {width,height,type};
 }
 root.CreatorFileImage={dimensions};
})(globalThis);
