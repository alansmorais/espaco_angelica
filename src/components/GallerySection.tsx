import React from 'react';
import { GALLERY_ITEMS } from '../data/mockData';

export const GallerySection: React.FC = () => {
  return (
    <section className="relative w-full px-4 sm:px-8 lg:px-12 py-16 bg-[#F7EFEA]/50 border-t border-[#E8D9B5]" id="galeria-nailart">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
              Portfólio de Alta Joalheria
            </span>
            <h2 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold mt-1">
              Galeria de Criações Recentes
            </h2>
          </div>

          <a
            href="https://instagram.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[#D4AF37] font-jakarta text-xs sm:text-sm font-semibold hover:underline"
          >
            <span>Ver mais no Instagram @angelicadocarmo_nails</span>
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </a>
        </div>

        {/* Gallery Mosaic Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {GALLERY_ITEMS.map((item, idx) => (
            <div
              key={idx}
              className="group relative rounded-2xl overflow-hidden aspect-[4/5] bg-[#FFFFFF] shadow-md border border-[#E8D9B5] hover:border-[#D4AF37]/60 transition-all hover:shadow-xl"
            >
              <img
                src={item.imageUrl}
                alt={item.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#49382E]/90 via-[#49382E]/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                <span className="text-[#FFE088] font-syne text-base font-bold">
                  {item.title}
                </span>
                <span className="text-[#FDFBF9] font-jakarta text-[11px]">
                  {item.subtitle}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
