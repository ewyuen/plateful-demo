import styles from './Credits.module.css'

function Credits() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.heading}>
          Photos from <a href="https://unsplash.com">Unsplash</a>
        </p>
        <p className={styles.note}>Plateful is a hackathon project. Payments use the PayPal sandbox.</p>
      </div>
    </footer>
  )
}

export default Credits
