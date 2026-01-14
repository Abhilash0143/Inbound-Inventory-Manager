import Lara from '@primeuix/themes/lara'

export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', '@primevue/nuxt-module', '@pinia/nuxt'],

  css: ['primeicons/primeicons.css'],

  primevue: {
    options: {
            theme: {
                preset: Lara
            }
        },
        
    
  }
})
