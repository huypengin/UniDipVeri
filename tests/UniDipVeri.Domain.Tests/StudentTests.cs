using FluentAssertions;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Tests;

public class StudentTests
{
    private readonly Guid _programId = Guid.NewGuid();

    [Fact]
    public void Create_ShouldInitializeWithDefaults()
    {
        var student = Student.Create(
            _programId,
            "STD-001",
            "Nguyen Van A",
            "a.nguyen@test.edu",
            "REF-001");

        student.Id.Should().NotBeEmpty();
        student.ProgramId.Should().Be(_programId);
        student.StudentNumber.Should().Be("STD-001");
        student.Name.Should().Be("Nguyen Van A");
        student.Email.Should().Be("a.nguyen@test.edu");
        student.SourceRecordRef.Should().Be("REF-001");
        student.AccountStatus.Should().Be(StudentAccountStatus.PENDING_ACTIVATION);
        student.GraduationStatus.Should().Be(GraduationStatus.NOT_STARTED);
        student.WalletStatus.Should().Be(WalletStatus.PENDING);
        student.WalletId.Should().BeNull();
        student.IsAccountActive().Should().BeFalse();
        student.IsWalletReady().Should().BeFalse();
    }

    [Theory]
    [InlineData("", "Name", "email@test.com", "REF")]
    [InlineData("STD-001", "", "email@test.com", "REF")]
    [InlineData("STD-001", "Name", "", "REF")]
    [InlineData("STD-001", "Name", "email@test.com", "")]
    public void Create_ShouldThrowArgumentException_WhenInvalidArgs(
        string number, string name, string email, string refId)
    {
        var act = () => Student.Create(_programId, number, name, email, refId);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_ShouldThrow_WhenProgramIdIsEmpty()
    {
        var act = () => Student.Create(Guid.Empty, "STD-001", "Name", "email@test.com", "REF");
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void ActivateAccount_ShouldSetActive_And_IsAccountActiveTrue()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        student.ActivateAccount();

        student.AccountStatus.Should().Be(StudentAccountStatus.ACTIVE);
        student.IsAccountActive().Should().BeTrue();
    }

    [Fact]
    public void DeactivateAccount_ShouldSetInactive_And_DeactivateActiveWallet()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        student.ActivateAccount();
        student.AssignWallet("wallet-123");

        student.DeactivateAccount();

        student.AccountStatus.Should().Be(StudentAccountStatus.INACTIVE);
        student.IsAccountActive().Should().BeFalse();
        student.WalletStatus.Should().Be(WalletStatus.INACTIVE);
        student.IsWalletReady().Should().BeFalse();
    }

    [Fact]
    public void DeactivateWallet_ShouldSetWalletStatusToInactive()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        student.AssignWallet("wallet-123");

        student.DeactivateWallet();

        student.WalletStatus.Should().Be(WalletStatus.INACTIVE);
        student.IsWalletReady().Should().BeFalse();
    }

    [Fact]
    public void UpdateGraduationStatus_ShouldUpdateStatus()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        student.UpdateGraduationStatus(GraduationStatus.ELIGIBLE);
        student.GraduationStatus.Should().Be(GraduationStatus.ELIGIBLE);

        student.UpdateGraduationStatus(GraduationStatus.GRADUATED);
        student.GraduationStatus.Should().Be(GraduationStatus.GRADUATED);
    }

    [Fact]
    public void IsWalletReady_ShouldReturnTrue_WhenActiveAndWalletIdPresent()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        student.AssignWallet("walt-wallet-123");

        student.IsWalletReady().Should().BeTrue();
    }

    [Fact]
    public void IsWalletReady_ShouldReturnFalse_WhenStatusIsNotActive()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        student.IsWalletReady().Should().BeFalse();

        student.AssignWallet("walt-wallet-123");
        student.DeactivateWallet();
        student.IsWalletReady().Should().BeFalse();
    }

    [Fact]
    public void AssignWallet_ShouldThrow_WhenWalletIdIsEmpty()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        var act = () => student.AssignWallet("");

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void MarkWalletFailed_ShouldSetStatusToFailed()
    {
        var student = Student.Create(_programId, "STD-001", "Name", "email@test.com", "REF");
        student.MarkWalletFailed();

        student.WalletStatus.Should().Be(WalletStatus.FAILED);
        student.IsWalletReady().Should().BeFalse();
    }

    [Fact]
    public void EntityEquality_ShouldBeBasedOnId()
    {
        var id = Guid.NewGuid();
        var student1 = Student.Create(_programId, "STD-001", "Name 1", "email1@test.com", "REF1", id: id);
        var student2 = Student.Create(_programId, "STD-002", "Name 2", "email2@test.com", "REF2", id: id);

        student1.Should().Be(student2);
        (student1 == student2).Should().BeTrue();
    }
}
