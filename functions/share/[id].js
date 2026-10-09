import {growthSeo} from '../../server/growth-seo.mjs';
export const onRequest=context=>growthSeo(context.request,context.env,{workId:context.params.id});
