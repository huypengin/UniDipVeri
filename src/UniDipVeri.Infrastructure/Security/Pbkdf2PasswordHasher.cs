using System.Security.Cryptography;
using UniDipVeri.Application.Abstractions.Security;

namespace UniDipVeri.Infrastructure.Security;

public sealed class Pbkdf2PasswordHasher : IPasswordHasher
{
    // OWASP recommends 600,000 for PBKDF2-HMAC-SHA256 as of 2023. 
    // Adjust based on server's performance tolerance.
    private const int SaltSize = 16;             // 128-bit salt (minimum recommended)
    private const int KeySize = 32;              // 256-bit derived key
    private const int Iterations = 600_000;
    private const string AlgorithmName = "sha256";

    private static readonly HashAlgorithmName HashAlgorithm = HashAlgorithmName.SHA256;

    public string HashPassword(string password)
    {
        // If a null or empty string reaches this method, it is a programmer error.
        ArgumentException.ThrowIfNullOrWhiteSpace(password);

        byte[] salt = RandomNumberGenerator.GetBytes(SaltSize);

        byte[] hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            Iterations,
            HashAlgorithm,
            KeySize);

        // Format: algorithm.iterations.salt.hash
        return string.Join(
            ".",
            AlgorithmName,
            Iterations,
            Convert.ToBase64String(salt),
            Convert.ToBase64String(hash));
    }

    public bool VerifyPassword(string password, string hashedPassword)
    {
        // An empty password here is not a system bug, it is simply an invalid credential.
        // However, the API/DTO layer should reject it early to avoid wasting server resources.
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(hashedPassword))
        {
            return false;
        }

        try
        {
            string[] parts = hashedPassword.Split('.');

            // Support both new format (4 parts) and legacy format (3 parts) if needed.
            int algorithmOffset = parts.Length == 4 ? 0 : -1;
            int iterationsIndex = algorithmOffset + 1;
            int saltIndex = algorithmOffset + 2;
            int hashIndex = algorithmOffset + 3;

            if (parts.Length < 3 || parts.Length > 4)
                return false;

            if (!int.TryParse(parts[iterationsIndex], out int iterations) || iterations <= 0)
                return false;

            byte[] salt = Convert.FromBase64String(parts[saltIndex]);
            byte[] expectedHash = Convert.FromBase64String(parts[hashIndex]);

            // Enforce minimums, not exact matches, to allow future upgrades.
            if (salt.Length < 16 || expectedHash.Length < 32)
                return false;

            // Dynamically use the expected hash length to ensure FixedTimeEquals doesn't throw 
            // an ArgumentException due to length mismatch, and to support legacy key sizes.
            byte[] actualHash = Rfc2898DeriveBytes.Pbkdf2(
                password,
                salt,
                iterations,
                HashAlgorithm, // Note: If add SHA512 support later, parse this from parts[0]
                expectedHash.Length);

            return CryptographicOperations.FixedTimeEquals(expectedHash, actualHash);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
