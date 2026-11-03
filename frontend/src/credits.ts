// One entry per file in src/assets/photos/. All photos are from Unsplash and are used
// under the Unsplash License (https://unsplash.com/license). A test checks that this
// list and the folder match, so a photo cannot be added without its credit.
export interface Credit {
  file: string
  photographer: string
  profileUrl: string
  photoUrl: string
}

export const credits: Credit[] = [
  {
    file: 'hero.webp',
    photographer: 'Raymond Yeung',
    profileUrl: 'https://unsplash.com/@optiny',
    photoUrl:
      'https://unsplash.com/photos/a-cozy-restaurant-interior-with-string-lights-Wzo_34cS5bA',
  },
  {
    file: 'dish.webp',
    photographer: 'Van Thanh',
    profileUrl: 'https://unsplash.com/@vanthanh2608',
    photoUrl: 'https://unsplash.com/photos/variety-of-cooked-foods-0RNqWu4AEVE',
  },
  {
    file: 'noodles.webp',
    photographer: 'Xavier Chng',
    profileUrl: 'https://unsplash.com/@cohesionsingapore',
    photoUrl:
      'https://unsplash.com/photos/a-person-holding-chopsticks-over-a-bowl-of-noodles-qguuVUzsavg',
  },
  {
    file: 'tea.webp',
    photographer: 'tommao wang',
    profileUrl: 'https://unsplash.com/@tommaomaoer',
    photoUrl:
      'https://unsplash.com/photos/a-cup-of-tea-and-a-plate-of-cookies-on-a-table-4GrilOcEoJg',
  },
]
