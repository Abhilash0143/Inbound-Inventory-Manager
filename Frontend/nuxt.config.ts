import Lara from '@primeuix/themes/lara'

export default defineNuxtConfig({
  modules: [
    '@nuxtjs/tailwindcss',
    '@primevue/nuxt-module',
    '@pinia/nuxt',
    '@vite-pwa/nuxt',
  ],

  css: ['primeicons/primeicons.css'],

  primevue: {
    options: {
      theme: {
        preset: Lara,
      },
    },
  },

   vite: {
    server: {
      allowedHosts: true, // ✅ allow ngrok host
    },
  },

  // ✅ PWA
  pwa: {
    registerType: 'autoUpdate',

    manifest: {
      name: 'Inbound Inventory',
      short_name: 'Inbound',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#111827',
      icons: [
        { src: 'icons/compassco icon.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/compassco icon.png', sizes: '512x512', type: 'image/png' },
      ],
    },
  },
})
