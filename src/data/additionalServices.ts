export interface BookingAddOn {
  id: string;
  title: string;
  price: number;
  description: string;
}

export const BOOKING_ADD_ONS: BookingAddOn[] = [
  { id: 'adicional-esmaltacao-gel', title: 'Esmaltação em Gel', price: 25, description: 'Esmaltação em gel sem decoração.' },
  { id: 'adicional-gel-francesinha', title: 'Esmaltação em Gel + decoração simples (Francesinha)', price: 30, description: 'Acabamento simples, como francesinha.' },
  { id: 'adicional-esmaltacao-tradicional', title: 'Esmaltação Tradicional', price: 15, description: 'Esmaltação tradicional.' },
  { id: 'adicional-baby-boomer', title: 'Baby Boomer', price: 30, description: 'Efeito Baby Boomer.' },
  { id: 'adicional-encapsulada', title: 'Encapsulada', price: 30, description: 'Decoração encapsulada.' },
  { id: 'adicional-cromado', title: 'Cromado', price: 30, description: 'Efeito cromado.' },
  { id: 'adicional-espelhado', title: 'Espelhado', price: 30, description: 'Efeito espelhado.' },
  { id: 'adicional-olho-de-gato', title: 'Olho de gato', price: 30, description: 'Efeito magnético olho de gato.' },
  { id: 'adicional-reversa-3d', title: 'Reversa 3D', price: 40, description: 'R$ 40,00 por unidade.' }
];

export const POLISH_ADD_ON_IDS = [
  'adicional-esmaltacao-gel',
  'adicional-gel-francesinha',
  'adicional-esmaltacao-tradicional'
];
