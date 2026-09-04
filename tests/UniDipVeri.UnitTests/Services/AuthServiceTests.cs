using FluentAssertions;
using Moq;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Services;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.UnitTests.Services;

public class AuthServiceTests
{
    private readonly Mock<IStaffRepository> _staffRepoMock = new();
    private readonly Mock<IStudentRepository> _studentRepoMock = new();
    private readonly Mock<IPasswordHasher> _hasherMock = new();
    private readonly Mock<ISessionIssuer> _issuerMock = new();
    private readonly AuthService _authService;
    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Guid _programId = Guid.NewGuid();

    public AuthServiceTests()
    {
        _authService = new AuthService(
            _staffRepoMock.Object,
            _studentRepoMock.Object,
            _hasherMock.Object,
            _issuerMock.Object);
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldReturnSuccess_WhenStaffCredentialsAreValid()
    {
        // Arrange
        var staffId = Guid.NewGuid();
        var staff = UniversityStaff.Create(
            _universityId,
            "Staff Member",
            "staff@test.com",
            "hashed_pass",
            StaffRole.REGISTRAR,
            id: staffId);

        _staffRepoMock.Setup(r => r.GetByEmailAsync("staff@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);
        _hasherMock.Setup(h => h.VerifyPassword("password123", "hashed_pass"))
            .Returns(true);
        _issuerMock.Setup(i => i.IssueStaffSession(staffId, "REGISTRAR"))
            .Returns(new SessionToken("jwt-token-staff", DateTime.UtcNow.AddHours(1)));

        // Act
        var result = await _authService.AuthenticateStaffAsync("staff@test.com", "password123");

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Token.Should().NotBeNull();
        result.Token!.Value.Should().Be("jwt-token-staff");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldFail_WhenStaffIsInactive()
    {
        // Arrange
        var staff = UniversityStaff.Create(
            _universityId,
            "Staff Member",
            "staff@test.com",
            "hashed_pass",
            StaffRole.REGISTRAR);
        staff.Deactivate();

        _staffRepoMock.Setup(r => r.GetByEmailAsync("staff@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(staff);

        // Act
        var result = await _authService.AuthenticateStaffAsync("staff@test.com", "password123");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldReturnSuccess_WhenStudentCredentialsAreValid_AndAccountIsActive()
    {
        // Arrange
        var studentId = Guid.NewGuid();
        var student = Student.Create(
            _programId,
            "STD123",
            "Student Name",
            "student@test.com",
            "REF123",
            "hashed_pass",
            id: studentId);
        student.ActivateAccount();

        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);
        _hasherMock.Setup(h => h.VerifyPassword("studentpass", "hashed_pass"))
            .Returns(true);
        _issuerMock.Setup(i => i.IssueStudentSession(studentId, "STD123"))
            .Returns(new SessionToken("jwt-token-student", DateTime.UtcNow.AddHours(1)));

        // Act
        var result = await _authService.AuthenticateStudentAsync("student@test.com", "studentpass");

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Token.Should().NotBeNull();
        result.Token!.Value.Should().Be("jwt-token-student");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldFail_WhenStudentAccountIsPendingActivation()
    {
        // Arrange
        var student = Student.Create(
            _programId,
            "STD123",
            "Student Name",
            "student@test.com",
            "REF123",
            "hashed_pass");

        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);

        // Act
        var result = await _authService.AuthenticateStudentAsync("student@test.com", "studentpass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldFail_WhenStudentAccountIsInactive()
    {
        // Arrange
        var student = Student.Create(
            _programId,
            "STD123",
            "Student Name",
            "student@test.com",
            "REF123",
            "hashed_pass");
        student.DeactivateAccount();

        _studentRepoMock.Setup(r => r.GetByEmailAsync("student@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(student);

        // Act
        var result = await _authService.AuthenticateStudentAsync("student@test.com", "studentpass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task AuthenticateAsync_ShouldFail_WhenUserNotFound()
    {
        // Arrange
        _staffRepoMock.Setup(r => r.GetByEmailAsync("unknown@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync((UniversityStaff?)null);
        _studentRepoMock.Setup(r => r.GetByEmailAsync("unknown@test.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync((Student?)null);

        // Act
        var result = await _authService.AuthenticateStaffAsync("unknown@test.com", "pass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");

        // Act
        result = await _authService.AuthenticateStudentAsync("unknown@test.com", "pass");

        // Assert
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Invalid email or password.");
    }
}
