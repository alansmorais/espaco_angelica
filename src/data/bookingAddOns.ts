export interface BookingAddOn {
  id: string;
  title: string;
  price: number;
  priceFormatted: string;
  description: string;
}

export const BOOKING_ADD_ONS: BookingAddOn[] = [
  { id: 'adicional-esmaltacao-gel', title: 'Esmaltação em Gel', price: 25, priceFormatted: 'R$ 25,00', description: 'Esmaltação em gel.' },
  { id: 'adicional-gel-decoracao-simples', title: 'Gel + decoração simples', price: 30, priceFormatted: 'R$ 30,00', description: 'Esmaltação em gel com decoração simples.' },
  { id: 'adicional-esmalte-tradicional', title: 'Esmaltação tradicional (esmalte comum)', price: 15, priceFormatted: 'R$ 15,00', description: 'Esmaltação com esmalte comum.' },
  { id: 'adicional-baby-boomer', title: 'Baby boomer', price: 30, priceFormatted: 'R$ 30,00', description: 'Acabamento Baby boomer.' },
  { id: 'adicional-encapsulada', title: 'Encapsulada', price: 30, priceFormatted: 'R$ 30,00', description: 'Decoração encapsulada.' },
  { id: 'adicional-cromado', title: 'Cromado', price: 30, priceFormatted: 'R$ 30,00', description: 'Efeito cromado.' },
  { id: 'adicional-espelhado', title: 'Espelhado', price: 30, priceFormatted: 'R$ 30,00', description: 'Efeito espelhado.' },
  { id: 'adicional-olho-de-gato', title: 'Olho de gato', price: 30, priceFormatted: 'R$ 30,00', description: 'Efeito olho de gato.' },
  { id: 'adicional-degrade', title: 'Degradê', price: 30, priceFormatted: 'R$ 30,00', description: 'Decoração em degradê.' },
  { id: 'adicional-marmorizado', title: 'Marmorizado', price: 30, priceFormatted: 'R$ 30,00', description: 'Efeito marmorizado.' },
  { id: 'adicional-holografico', title: 'Holográfico', price: 30, priceFormatted: 'R$ 30,00', description: 'Efeito holográfico.' },
  { id: 'adicional-reversa-3d', title: 'Reversa 3D', price: 40, priceFormatted: 'R$ 40,00/unidade', description: 'Reversa 3D cobrada por unidade; exclusiva para alongamento em fibra.' }
];
